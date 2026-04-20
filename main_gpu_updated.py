"""IntelliMail Classifier API  —  generated Thursday 05 March 2026 12:34:19 PM IST"""
import asyncio, json, os, re, time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import uvloop; uvloop.install()
except ImportError:
    pass

import httpx, orjson, structlog, uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, validator
from tenacity import (retry, stop_after_attempt,
                      wait_exponential, retry_if_exception_type)

OLLAMA_URL  = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
MODEL       = os.getenv("OLLAMA_MODEL",    "intellimail-qwen")
WORKERS     = int(os.getenv("LLM_WORKERS", "3"))
PORT        = int(os.getenv("API_PORT",    "8765"))

structlog.configure(processors=[structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level, structlog.processors.JSONRenderer()])
log = structlog.get_logger()

class St:
    client: httpx.AsyncClient = None
    sem: asyncio.Semaphore    = None
    circuit_open    = False
    circuit_fails   = 0
    circuit_ts: float = 0
    req_total = req_ok = req_fail = 0
    tfidf_model = None
    stages   = {"hard_filter":0,"rule_engine":0,"tfidf":0,"local_llm":0,"error":0}
    lat_sum: float = 0; lat_n = 0

S = St()

@asynccontextmanager
async def lifespan(app):
    S.client = httpx.AsyncClient(base_url=OLLAMA_URL,
        timeout=httpx.Timeout(connect=5, read=120, write=10, pool=5),
        limits=httpx.Limits(max_connections=WORKERS+2, max_keepalive_connections=WORKERS))
    S.sem = asyncio.Semaphore(WORKERS)
    # Load TF-IDF model
    try:
        import joblib
        _model_path = Path("/opt/intellimail-classifier/data/tfidf_model.joblib")
        if _model_path.exists():
            S.tfidf_model = joblib.load(str(_model_path))
            log.info("tfidf_loaded", path=str(_model_path))
        else:
            log.warning("tfidf_model_not_found", path=str(_model_path))
    except Exception as _ex:
        log.warning("tfidf_load_failed", err=str(_ex))
    await warmup()
    log.info("ready", model=MODEL, workers=WORKERS, port=PORT)
    yield
    await S.client.aclose()

app = FastAPI(title="IntelliMail Classifier", version="1.0.0",
              default_response_class=ORJSONResponse, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["GET","POST"], allow_headers=["*"])

# ── Pydantic models ───────────────────────────────────────────────────────────
class EIn(BaseModel):
    subject:            str   = Field(..., min_length=1, max_length=500)
    from_address:       str   = Field(..., min_length=3, max_length=254)
    from_name:          Optional[str] = None
    preview:            Optional[str] = Field(None, max_length=1000)
    body_text:          Optional[str] = Field(None, max_length=4000)
    email_id:           Optional[str] = None
    is_internal_sender: bool  = False
    sender_score:       float = Field(0.5, ge=0, le=1)
    category_hint:      Optional[str] = None
    hint_confidence:    Optional[float] = None

    @validator("from_address")
    def v_email(cls, v):
        if "@" not in v: raise ValueError("bad email")
        return v.lower().strip()

    def prompt(self) -> str:
        lines = [f"From: {self.from_name or ''} <{self.from_address}>",
                 f"Subject: {self.subject}"]
        if self.is_internal_sender: lines.append("Context: Internal colleague (same org)")
        if self.sender_score > 0.7:  lines.append(f"Context: Trusted sender ({self.sender_score:.2f})")
        if self.category_hint:
            lines.append(f"Hint: likely '{self.category_hint}' "
                         f"({int((self.hint_confidence or 0)*100)}% conf). Confirm or correct.")
        lines.append("")
        lines.append((self.body_text or self.preview or "")[:800])
        return "\n".join(lines)

class CResult(BaseModel):
    email_id: Optional[str]; category: str; confidence: float
    urgency: str; urgency_reason: Optional[str]; summary: str
    extracted_data: dict; draft_reply: str; suggested_tone: str
    include_in_briefing: bool; stage: str; processing_ms: int
    model: str; timestamp: str

class BIn(BaseModel):
    emails: list[EIn] = Field(..., min_items=1, max_items=50)
    fail_fast: bool = False

class BResult(BaseModel):
    results: list[CResult]; total: int
    success_count: int; failed_count: int; total_ms: int

# ── Hard filter (Stage 2) — zero LLM cost ────────────────────────────────────
MKT_HEADERS   = {"list-unsubscribe","list-id","list-post","x-campaign-id",
                 "x-mailchimp-id","x-sg-eid","x-klaviyo-id","x-mailer-recency"}
MKT_SUBJECTS  = ["% off","% discount","limited time","exclusive offer",
                 "shop now","free shipping","unsubscribe","opt out"]
AUTO_SUBJECTS = ["out of office","automatic reply","auto-reply",
                 "on vacation","away from"]

def hard_filter(e: EIn, hdrs: dict=None):
    hdrs = hdrs or {}
    sl   = e.subject.lower()
    hk   = {k.lower() for k in hdrs}
    if hk & MKT_HEADERS:                                           return _fr("mkt_hdr","other","normal","Marketing email",False)
    if hdrs.get("precedence","").lower() in ("bulk","list","junk"): return _fr("bulk","other","normal","Bulk email",False)
    if any(p in sl for p in AUTO_SUBJECTS):                        return _fr("autoreply","fyi","normal","Auto-reply",False)
    fa = e.from_address.lower()
    if "mailer-daemon" in fa or "postmaster@" in fa:               return _fr("bounce","other","normal","Bounce",False)
    if e.sender_score < 0.4 and any(p in sl for p in MKT_SUBJECTS):return _fr("mkt_subj","other","normal","Promotional",False)
    return None

def _fr(nm, cat, urg, summ, briefing):
    return {"category":cat,"confidence":0.99,"urgency":urg,"urgency_reason":None,
            "summary":summ,"extracted_data":{},"draft_reply":"",
            "suggested_tone":"brief","include_in_briefing":briefing,
            "stage":f"hard_filter:{nm}"}

# ── Rule engine (Stage 3) — high-confidence patterns ─────────────────────────
RULES = [
    {"n":"ical",       "cat":"meeting_request", "w":0.97,
     "fn":lambda e: "begin:vcalendar" in (e.body_text or e.preview or "").lower()},
    {"n":"cal_subj",   "cat":"meeting_request", "w":0.90,
     "fn":lambda e: any(e.subject.lower().startswith(p)
       for p in ["invitation:","accepted:","declined:","cancelled:","updated:"])},
    {"n":"meet_kw",    "cat":"meeting_request", "w":0.82,
     "fn":lambda e: any(p in e.subject.lower()
       for p in ["meeting request","schedule a call","book a meeting",
                 "interview invitation","demo request","sync up"])},
    {"n":"statement",  "cat":"financial",        "w":0.88,
     "fn":lambda e: any(p in e.subject.lower()
       for p in ["statement","invoice","payment due","amount due",
                 "bill ready","receipt","transaction alert"])},
    {"n":"legal_kw",   "cat":"legal",            "w":0.87,
     "fn":lambda e: any(p in e.subject.lower()
       for p in ["legal notice","cease and desist","without prejudice",
                 "pursuant to","demand letter","summons","subpoena"])},
    {"n":"booking",    "cat":"travel",            "w":0.93,
     "fn":lambda e: any(p in e.subject.lower()
       for p in ["booking confirmation","e-ticket","itinerary",
                 "reservation confirmed","check-in","boarding pass",
                 "flight confirmation","pnr"])},
    {"n":"rewards",    "cat":"rewards_awards",    "w":0.85,
     "fn":lambda e: any(p in e.subject.lower()
       for p in ["points expiring","miles expiring","reward points",
                 "cashback earned","loyalty reward","redeem your"])},
    {"n":"int_fyi",    "cat":"fyi",               "w":0.80,
     "fn":lambda e: e.is_internal_sender and any(p in e.subject.lower()
       for p in ["fyi","for your info","heads up","announcement","company update"])},
]

DRAFTS = {
    "meeting_request":"Thank you for the invitation. I will confirm shortly.",
    "financial":      "Thank you. I have noted the details.",
    "legal":          "Thank you. I acknowledge receipt and will review with legal counsel.",
    "travel":         "Thank you for the booking confirmation. Details noted.",
    "pitch_deck":     "Thank you for reaching out. I will review and respond.",
    "rewards_awards": "Thank you for the notification. Details noted.",
    "fyi":            "Thank you for the update.",
    "other":          "Thank you for your email. I will review and respond.",
}

def rule_engine(e: EIn):
    hits = [r for r in RULES if _chk(r, e)]
    if not hits: return None
    votes: dict = {}
    for r in hits: votes[r["cat"]] = votes.get(r["cat"], 0) + r["w"]
    best_cat, best_sc = max(votes.items(), key=lambda x: x[1])
    conf = min(best_sc, 1.0)
    if conf < 0.85:
        return {"resolved":False,"category_hint":best_cat,"hint_confidence":conf}
    text = e.subject + " " + (e.preview or "")
    urg  = ("urgent"   if any(p in text.lower() for p in
              ["urgent","asap","immediately","overdue","deadline today"]) else
            "moderate" if any(p in text.lower() for p in
              ["by tomorrow","due soon","expires soon","action needed"]) else "normal")
    return {"resolved":True,"category":best_cat,"confidence":conf,"urgency":urg,
            "urgency_reason":None,"summary":f"Rule-classified as {best_cat}.",
            "extracted_data":{},"draft_reply":DRAFTS.get(best_cat,""),
            "suggested_tone":"professional","include_in_briefing":best_cat!="other",
            "stage":f"rule_engine:{hits[0]['n']}"}

def _chk(rule, e):
    try:    return rule["fn"](e)
    except: return False

# ── TF-IDF classifier (Stage 4) ───────────────────────────────────────────────
TFIDF_THRESHOLD = 0.75

def tfidf_classify(e: EIn):
    """Tier 3: TF-IDF sklearn classifier (~3ms). Returns resolved dict or None."""
    if S.tfidf_model is None:
        return None
    try:
        text = " ".join(filter(None, [
            e.subject or "",
            e.from_address or "",
            e.from_name or "",
            (e.preview or "")[:400],
        ])).lower()
        proba = S.tfidf_model.predict_proba([text])[0]
        max_proba = float(proba.max())
        if max_proba < TFIDF_THRESHOLD:
            return None  # not confident enough — fall through to LLM
        category = S.tfidf_model.classes_[proba.argmax()]
        text_lower = (e.subject + " " + (e.preview or "")).lower()
        urgency = (
            "urgent"   if any(p in text_lower for p in ["urgent","asap","immediately","overdue","deadline today"]) else
            "moderate" if any(p in text_lower for p in ["by tomorrow","due soon","expires soon","action needed"]) else
            "normal"
        )
        return {
            "resolved": True,
            "category": category,
            "confidence": round(max_proba, 3),
            "urgency": urgency,
            "urgency_reason": None,
            "summary": f"Classified as {category} (TF-IDF, {max_proba:.0%} confidence).",
            "extracted_data": {},
            "draft_reply": DRAFTS.get(category, ""),
            "suggested_tone": "professional",
            "include_in_briefing": category != "other",
            "stage": f"tfidf:{category}",
        }
    except Exception as ex:
        log.warning("tfidf_error", err=str(ex))
        return None

# ── LLM call (Stage 5) ────────────────────────────────────────────────────────
CB_LIMIT = 5; CB_RESET = 60

@retry(stop=stop_after_attempt(2),
       wait=wait_exponential(multiplier=1, min=1, max=10),
       retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
       reraise=True)
async def call_llm(prompt: str) -> dict:
    if S.circuit_open:
        if time.time() - S.circuit_ts < CB_RESET:
            raise HTTPException(503, "Circuit breaker open")
        S.circuit_open = False; S.circuit_fails = 0
    try:
        r = await S.client.post("/api/chat", json={
            "model": MODEL,
            "messages": [{"role":"user","content":prompt}],
            "stream": False, "format": "json",
            "options": {"temperature":0.05,"top_p":0.9,"top_k":20,
                        "num_predict":60,"num_ctx":512,"repeat_penalty":1.1}
        })
        r.raise_for_status(); S.circuit_fails = 0
        txt = r.json()["message"]["content"]
        try:    return json.loads(txt)
        except:
            m = re.search(r'\{.*\}', txt, re.DOTALL)
            if m: return json.loads(m.group())
            raise ValueError(f"Bad JSON from LLM: {txt[:120]}")
    except Exception as ex:
        S.circuit_fails += 1; S.circuit_ts = time.time()
        if S.circuit_fails >= CB_LIMIT: S.circuit_open = True
        raise

def norm(d: dict) -> dict:
    CATS = {"meeting_request","financial","legal","travel",
            "pitch_deck","fyi","rewards_awards","other"}
    URGS = {"urgent","moderate","normal"}
    if d.get("category") not in CATS: d["category"] = "other"
    if d.get("urgency")  not in URGS: d["urgency"]  = "normal"
    d.setdefault("confidence", 0.7)
    d.setdefault("urgency_reason", None)
    d.setdefault("summary", "Classification complete.")
    d.setdefault("extracted_data", {})
    d.setdefault("draft_reply", DRAFTS.get(d["category"],""))
    d.setdefault("suggested_tone", "professional")
    d.setdefault("include_in_briefing", d["category"] != "other")
    return d

# ── Pipeline orchestrator ─────────────────────────────────────────────────────
async def classify(email: EIn, hdrs: dict=None) -> CResult:
    t0 = time.monotonic(); S.req_total += 1
    try:
        hf = hard_filter(email, hdrs or {})
        if hf:
            S.stages["hard_filter"] += 1
            return _mk(email, hf, t0)

        re = rule_engine(email)
        if re and re.get("resolved"):
            S.stages["rule_engine"] += 1
            return _mk(email, re, t0)

        # Tier 3: TF-IDF classifier (fast, CPU, <5ms)
        _tfidf_input = email.copy(update={"category_hint": re.get("category_hint"), "hint_confidence": re.get("hint_confidence")}) if re and not re.get("resolved") else email
        tf = tfidf_classify(_tfidf_input)
        if tf and tf.get("resolved"):
            S.stages["tfidf"] = S.stages.get("tfidf", 0) + 1
            S.req_ok += 1
            return _mk(email, tf, t0)

        hint = email
        if re and not re.get("resolved"):
            hint = email.copy(update={"category_hint":re.get("category_hint"),
                                      "hint_confidence":re.get("hint_confidence")})
        async with S.sem:
            raw = await call_llm(hint.prompt())
        d = norm(raw); d["stage"] = "local_llm"
        S.stages["local_llm"] += 1; S.req_ok += 1
        ms = int((time.monotonic()-t0)*1000); S.lat_sum += ms; S.lat_n += 1
        return _mk(email, d, t0)

    except Exception as ex:
        S.req_fail += 1; S.stages["error"] += 1
        log.error("classify_error", err=str(ex))
        return _mk(email, {"category":"other","confidence":0.0,"urgency":"normal",
            "urgency_reason":None,"summary":"Classification failed — review manually.",
            "extracted_data":{},"draft_reply":"","suggested_tone":"brief",
            "include_in_briefing":False,"stage":f"error:{type(ex).__name__}"}, t0)

def _mk(email: EIn, d: dict, t0: float) -> CResult:
    return CResult(
        email_id=email.email_id, category=d["category"], confidence=d["confidence"],
        urgency=d["urgency"], urgency_reason=d.get("urgency_reason"), summary=d["summary"],
        extracted_data=d.get("extracted_data",{}), draft_reply=d.get("draft_reply",""),
        suggested_tone=d.get("suggested_tone","professional"),
        include_in_briefing=d.get("include_in_briefing",True),
        stage=d.get("stage","unknown"), processing_ms=int((time.monotonic()-t0)*1000),
        model=MODEL, timestamp=datetime.utcnow().isoformat())

async def warmup():
    try:
        await S.client.post("/api/generate",
            json={"model":MODEL,"prompt":"warmup","stream":False,"options":{"num_predict":1}},
            timeout=30)
        log.info("model_warm")
    except Exception as ex:
        log.warning("warmup_failed", err=str(ex))

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    try:
        r = await S.client.get("/api/version", timeout=3); ok2 = r.status_code==200
        ver = r.json().get("version","?") if ok2 else "unreachable"
    except: ok2 = False; ver = "unreachable"
    avg = S.lat_sum/S.lat_n if S.lat_n else 0
    return {"status":"healthy" if ok2 else "degraded","model":MODEL,"workers":WORKERS,
            "ollama":{"connected":ok2,"version":ver,"circuit_open":S.circuit_open},
            "stats":{"requests_total":S.req_total,"requests_success":S.req_ok,
                     "requests_failed":S.req_fail,"stage_counts":S.stages,
                     "avg_latency_ms":round(avg,1)}}

@app.post("/classify", response_model=CResult)
async def ep_classify(email: EIn, request: Request):
    hdrs = {}
    raw_h = request.headers.get("x-email-headers")
    if raw_h:
        try: hdrs = json.loads(raw_h)
        except: pass
    return await classify(email, hdrs)

@app.post("/classify/batch", response_model=BResult)
async def ep_batch(batch: BIn):
    t0 = time.monotonic()
    results = await asyncio.gather(*[classify(e) for e in batch.emails],
                                   return_exceptions=not batch.fail_fast)
    final, ok_count, fail_count = [], 0, 0
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            fail_count += 1
            final.append(CResult(email_id=batch.emails[i].email_id, category="other",
                confidence=0, urgency="normal", urgency_reason=None, summary="Error",
                extracted_data={}, draft_reply="", suggested_tone="brief",
                include_in_briefing=False, stage=f"error:{type(r).__name__}",
                processing_ms=0, model=MODEL, timestamp=datetime.utcnow().isoformat()))
        else:
            ok_count += 1; final.append(r)
    return BResult(results=final, total=len(batch.emails), success_count=ok_count,
                   failed_count=fail_count, total_ms=int((time.monotonic()-t0)*1000))

@app.get("/metrics")
async def metrics():
    avg = S.lat_sum/S.lat_n if S.lat_n else 0
    lines = [f"imail_requests_total {S.req_total}",
             f"imail_requests_success {S.req_ok}",
             f"imail_avg_latency_ms {avg:.1f}",
             f"imail_circuit_open {1 if S.circuit_open else 0}"] +             [f'imail_stage{{stage="{s}"}} {c}' for s,c in S.stages.items()]
    return PlainTextResponse("\n".join(lines))

@app.post("/model/reload")
async def reload():
    await S.client.post("/api/generate", json={"model":MODEL,"keep_alive":0})
    await warmup()
    return {"status":"reloaded","model":MODEL}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="warning", workers=1)
