"""
IntelliMail TF-IDF Training Pipeline
=====================================
Downloads Enron/AESLC email datasets from HuggingFace, auto-labels them using
the same rule_engine keyword logic as the FastAPI classifier, trains a
TF-IDF + LogisticRegression model, and saves everything offline for reuse.

Run locally:
    python data/build_tfidf.py

Run on staging (via SSH):
    python data/build_tfidf.py --deploy
"""

import sys, os, re, json, argparse, random
sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(DATA_DIR, 'tfidf_model.joblib')

# ── Rule engine (mirrors FastAPI main.py logic) ───────────────────────────────

def rule_classify(subject, body, from_address):
    """Port of FastAPI rule_engine. Returns category string or None."""
    sub  = (subject      or '').lower()
    frm  = (from_address or '').lower()
    body = (body         or '')[:400].lower()
    all_ = sub + ' ' + body

    # Travel
    if re.search(r'\bpnr\b|booking confirm|flight booking|hotel reserv|check.in|itinerary|e.ticket|boarding pass', sub):
        return 'travel'
    if re.search(r'indigo|spicejet|air india|airindia|vistara|goair|akasa|makemytrip|goibibo|cleartrip|booking\.com|airbnb|hotels\.com|marriott|oyo', frm):
        return 'travel'
    if re.search(r'\bpnr\b', all_) and re.search(r'flight|train|hotel|booking', all_):
        return 'travel'

    # Financial
    if re.search(r'invoice|amount due|payment due|overdue|bill no|invoice no|inv-\d|gst|outstanding balance', sub):
        return 'financial'
    if re.search(r'bank statement|account statement|transaction alert|salary credit|payslip|pay slip|remittance', sub):
        return 'financial'
    if re.search(r'invoice|payment|amount due|rs\.?\s*\d|inr\s*\d|\$\s*\d|bill.*amount|due.*amount', all_) \
       and re.search(r'invoice|payment|bill|due|amount', sub):
        return 'financial'

    # Legal
    if re.search(r'legal notice|contract|agreement|nda|terms.*condition|privacy policy|gdpr|compliance|lawsuit|litigation|arbitration|court', sub):
        return 'legal'
    if re.search(r'renewal.*intimation|contract renewal|agreement renewal|expire.*domain|domain.*expire', sub):
        return 'legal'

    # Meeting request
    if re.search(r'meeting|invite|calendar|agenda|conference|webinar|standup|sync|town hall|all.hands', sub):
        return 'meeting_request'
    if re.search(r'zoom\.us|teams\.microsoft|meet\.google|webex\.com|calendly\.com', frm):
        return 'meeting_request'

    # Pitch deck
    if re.search(r'pitch deck|series [abc]|seed round|funding round|investor|venture capital|startup.*invest|deck.*review', sub):
        return 'pitch_deck'

    # Rewards / awards
    if re.search(r'reward|award|recogni|congratulat|winner|achievement|bonus|incentive|voucher|gift card|loyalty point', sub):
        return 'rewards_awards'

    # FYI (newsletters, digests, reports)
    if re.search(r'newsletter|digest|weekly update|monthly update|report|bulletin|announce|fyi|for your information', sub):
        return 'fyi'
    if re.search(r'unsubscribe|opt.out|mailing list|no-reply|noreply', frm):
        return 'fyi'

    return None


# ── Dataset download ──────────────────────────────────────────────────────────

def download_aeslc():
    """Download AESLC (18K Enron emails). Save raw JSONL locally."""
    from datasets import load_dataset
    raw_path = os.path.join(DATA_DIR, 'aeslc_raw.jsonl')
    if os.path.exists(raw_path):
        print(f'  AESLC already cached at {raw_path}')
        return raw_path

    print('  Downloading AESLC from HuggingFace...')
    ds = load_dataset('aeslc', trust_remote_code=True)
    rows = []
    for split in ('train', 'validation', 'test'):
        if split in ds:
            for item in ds[split]:
                rows.append({
                    'subject': (item.get('subject_line') or '').strip(),
                    'body':    (item.get('email_body')   or '').strip()[:600],
                    'from':    '',
                    'source':  'aeslc'
                })
    with open(raw_path, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'  Saved {len(rows):,} AESLC emails → {raw_path}')
    return raw_path


def download_enron_spam():
    """Download Enron spam dataset (spam/ham, ~33K emails). Save raw JSONL."""
    from datasets import load_dataset
    raw_path = os.path.join(DATA_DIR, 'enron_spam_raw.jsonl')
    if os.path.exists(raw_path):
        print(f'  Enron-spam already cached at {raw_path}')
        return raw_path

    print('  Downloading Enron-spam from HuggingFace...')
    ds = load_dataset('SetFit/enron_spam', trust_remote_code=True)
    rows = []
    for split in ds:
        for item in ds[split]:
            # skip spam-labeled emails (label=1 = spam in this dataset)
            if item.get('label', 0) == 1:
                continue
            rows.append({
                'subject': (item.get('subject') or '').strip(),
                'body':    (item.get('message') or item.get('text') or '').strip()[:600],
                'from':    (item.get('sender')  or '').strip(),
                'source':  'enron_spam'
            })
    with open(raw_path, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'  Saved {len(rows):,} Enron ham emails → {raw_path}')
    return raw_path


# ── Load existing handcrafted training data ───────────────────────────────────

def load_existing_training():
    """Load hand-labeled training.jsonl if it exists on staging or locally."""
    path = os.path.join(DATA_DIR, 'training.jsonl')
    rows = []
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                    if d.get('category') and d.get('subject'):
                        rows.append({'subject': d['subject'], 'body': d.get('body',''), 'from': d.get('from_address',''), 'category': d['category']})
                except:
                    pass
        print(f'  Loaded {len(rows)} hand-labeled examples from training.jsonl')
    return rows


# ── Auto-label using rule_engine ──────────────────────────────────────────────

def auto_label(raw_path, max_per_cat=2000):
    """Apply rule_engine to raw emails. Returns list of {text, category}."""
    labeled = {cat: [] for cat in ['travel','financial','legal','meeting_request','pitch_deck','rewards_awards','fyi']}
    skipped = 0
    with open(raw_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except:
                continue
            cat = rule_classify(row.get('subject',''), row.get('body',''), row.get('from',''))
            if cat and len(labeled[cat]) < max_per_cat:
                labeled[cat].append({'subject': row['subject'], 'body': row.get('body',''), 'from': row.get('from',''), 'category': cat})
            else:
                skipped += 1

    total = sum(len(v) for v in labeled.values())
    print(f'  Auto-labeled: {total:,} emails (skipped {skipped:,})')
    for cat, items in labeled.items():
        print(f'    {cat}: {len(items)}')
    return [item for items in labeled.values() for item in items]


# ── Build combined labeled dataset ────────────────────────────────────────────

def build_labeled_dataset(sources):
    """Merge all sources, balance, shuffle. Save to labeled_training.jsonl."""
    all_data = []
    for items in sources:
        all_data.extend(items)

    # Balance: cap each category at median * 2 to avoid skew
    from collections import Counter
    counts = Counter(d['category'] for d in all_data)
    print(f'\n  Pre-balance counts: {dict(counts)}')
    median = sorted(counts.values())[len(counts)//2]
    cap = max(median * 2, 100)

    per_cat = {cat: [] for cat in counts}
    random.seed(42)
    random.shuffle(all_data)
    for d in all_data:
        if len(per_cat[d['category']]) < cap:
            per_cat[d['category']].append(d)

    balanced = [d for items in per_cat.values() for d in items]
    random.shuffle(balanced)

    counts2 = Counter(d['category'] for d in balanced)
    print(f'  Post-balance counts: {dict(counts2)}')
    print(f'  Total training examples: {len(balanced):,}')

    out_path = os.path.join(DATA_DIR, 'labeled_training.jsonl')
    with open(out_path, 'w', encoding='utf-8') as f:
        for d in balanced:
            f.write(json.dumps({'subject': d['subject'], 'body': d.get('body',''), 'from_address': d.get('from',''), 'category': d['category']}, ensure_ascii=False) + '\n')
    print(f'  Saved → {out_path}')
    return balanced


# ── Train TF-IDF model ────────────────────────────────────────────────────────

def train_model(data):
    from sklearn.pipeline import Pipeline
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    import numpy as np
    import joblib

    texts  = [f"{d['subject']} {d.get('from','')} {d.get('body','')}".lower() for d in data]
    labels = [d['category'] for d in data]

    print('\n  Training TF-IDF + LogisticRegression...')
    model = Pipeline([
        ('tfidf', TfidfVectorizer(
            ngram_range=(1, 2),
            max_features=30000,
            sublinear_tf=True,
            min_df=2,
            strip_accents='unicode'
        )),
        ('clf', LogisticRegression(
            C=5.0,
            max_iter=1000,
            class_weight='balanced',
            solver='lbfgs',
            multi_class='multinomial'
        ))
    ])

    scores = cross_val_score(model, texts, labels, cv=5, scoring='accuracy')
    print(f'  Cross-val accuracy: {scores.mean():.1%} ± {scores.std():.1%}')

    model.fit(texts, labels)

    # Sanity checks
    checks = [
        ('Invoice amount due Rs 50000 vendor@company.com',                          'financial'),
        ('PNR AI12345 Indigo flight confirmed noreply@goindigo.in',                 'travel'),
        ('Team meeting agenda Friday 3pm manager@corp.com',                         'meeting_request'),
        ('Legal notice contract renewal DATA INFOSYS legal@court.in',               'legal'),
        ('Company newsletter monthly update digest hr@company.com',                 'fyi'),
        ('Startup pitch deck Series A investor review founder@startup.io',          'pitch_deck'),
        ('Congratulations award recognition bonus achievement hr@company.com',      'rewards_awards'),
    ]
    print('\n  Sanity checks:')
    passed = 0
    for text, expected in checks:
        pred  = model.predict([text.lower()])[0]
        proba = model.predict_proba([text.lower()])[0].max()
        ok    = '✓' if pred == expected else '✗'
        if pred == expected: passed += 1
        print(f'    {ok} {expected:20s} → {pred:20s} ({proba:.0%})')
    print(f'  {passed}/{len(checks)} checks passed')

    joblib.dump(model, MODEL_PATH)
    print(f'\n  Model saved → {MODEL_PATH}')
    return model


# ── Deploy to staging ─────────────────────────────────────────────────────────

def deploy_to_staging():
    import paramiko
    print('\n  Deploying to staging 10.11.13.237...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
    sftp = ssh.open_sftp()

    remote_model = '/opt/intellimail-classifier/data/tfidf_model.joblib'
    sftp.put(MODEL_PATH, remote_model)

    def run(cmd):
        _, o, e = ssh.exec_command(cmd, timeout=15)
        return (o.read() + e.read()).decode('utf-8', errors='replace').strip()

    run(f'chown intellimail:intellimail {remote_model}')
    print('  Restarting intellimail-classifier service...')
    run('systemctl restart intellimail-classifier')

    import time; time.sleep(4)
    health = run('curl -s --max-time 5 http://localhost:8765/health')
    try:
        h = json.loads(health)
        print(f'  Staging health: {h["status"]} | ollama_connected={h["ollama"]["connected"]}')
    except:
        print(f'  Health: {health[:80]}')

    sftp.close()
    ssh.close()
    print('  Deployed.')


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--deploy', action='store_true', help='Upload model to staging after training')
    parser.add_argument('--skip-download', action='store_true', help='Skip download if raw files exist')
    args = parser.parse_args()

    print('=== Step 1: Download datasets ===')
    aeslc_path      = download_aeslc()
    enron_spam_path = download_enron_spam()

    print('\n=== Step 2: Auto-label with rule_engine ===')
    print('  Processing AESLC...')
    aeslc_labeled = auto_label(aeslc_path, max_per_cat=1500)
    print('  Processing Enron-spam...')
    enron_labeled = auto_label(enron_spam_path, max_per_cat=1500)

    print('\n=== Step 3: Load hand-labeled data ===')
    handcrafted = load_existing_training()

    print('\n=== Step 4: Build balanced training set ===')
    all_data = build_labeled_dataset([aeslc_labeled, enron_labeled, handcrafted])

    print('\n=== Step 5: Train TF-IDF model ===')
    train_model(all_data)

    if args.deploy:
        print('\n=== Step 6: Deploy to staging ===')
        deploy_to_staging()

    print('\nDone. Files saved in data/:')
    for fn in ['aeslc_raw.jsonl','enron_spam_raw.jsonl','labeled_training.jsonl','tfidf_model.joblib']:
        p = os.path.join(DATA_DIR, fn)
        if os.path.exists(p):
            size = os.path.getsize(p) / 1024
            print(f'  {fn:35s}  {size:8.1f} KB')
