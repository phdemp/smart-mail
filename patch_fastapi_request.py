import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
sftp = ssh.open_sftp()

remote = '/opt/intellimail-classifier/api/main.py'
with sftp.open(remote, 'r') as f:
    content = f.read().decode('utf-8')

def run(cmd, timeout=15):
    _, o, e = ssh.exec_command(cmd, timeout=timeout)
    return (o.read()+e.read()).decode('utf-8','replace').strip()

# 1. Add 'request' to CATS in norm()
old_cats = '"meeting_request","financial","legal","travel",\n            "pitch_deck","fyi","rewards_awards","other"'
new_cats = '"meeting_request","financial","legal","travel",\n            "pitch_deck","fyi","rewards_awards","request","other"'
if old_cats in content:
    content = content.replace(old_cats, new_cats)
    print('Patch 1: added request to CATS')
else:
    print('WARNING: CATS line not found')

# 2. Add request rule_engine block before the LLM call section
request_rules = '''
def rule_request(e):
    """Stage: detect HR/approval/procurement requests."""
    sub  = (e.subject or '').lower()
    body = ((e.preview or '') + (e.body_text or ''))[:400].lower()
    all_ = sub + ' ' + body
    # HR requests
    if re.search(r'leave|holiday|gate pass|attendance|payroll|salary slip|timesheet|appraisal|increment|resignation|wfh|work from home|comp off|half day', sub): return True
    if re.search(r'leave approval|restricted holiday|casual leave|sick leave|comp off', all_): return True
    # Approval / document signing
    if re.search(r'\\bapproval\\b|\\bapprove\\b|digital sign|esign|countersign|\\bsanction\\b|performance allowance', sub): return True
    # Procurement
    if re.search(r'purchase order|\\brfq\\b|quotation|sfp|transceiver|fiber patch|kvm|\\bups\\b.*battery|procurement|material.*indent|hardware.*order', sub): return True
    return False

'''

# Insert before the LLM call section marker
marker = '# ── LLM call (Stage 5) ────────────────────────────────────────────────────────'
if marker in content and 'rule_request' not in content:
    content = content.replace(marker, request_rules + marker)
    print('Patch 2: rule_request function added')
else:
    print('Patch 2: skipped (already exists or marker not found)')

# 3. Add request tier in classify() pipeline after tfidf, before LLM
old_pipeline = '''        hint = email
        if re and not re.get("resolved"):'''
new_pipeline = '''        # Tier 3b: Request rule check (HR/approval/procurement)
        if rule_request(email):
            S.stages["rule_engine"] = S.stages.get("rule_engine", 0) + 1
            req_result = {"resolved":True,"category":"request","confidence":0.9,"urgency":"normal",
                "urgency_reason":None,"summary":"Request email (HR/approval/procurement).",
                "extracted_data":{},"draft_reply":"Thank you for your request. We will review and respond shortly.",
                "suggested_tone":"professional","include_in_briefing":True,"stage":"rule_engine:request"}
            S.req_ok += 1
            return _mk(email, req_result, t0)

        hint = email
        if re and not re.get("resolved"):'''

if old_pipeline in content and 'rule_request' not in content.split(marker)[1][:500]:
    content = content.replace(old_pipeline, new_pipeline)
    print('Patch 3: request tier added to pipeline')
else:
    # Try simpler check
    if 'rule_engine:request' not in content:
        content = content.replace(old_pipeline, new_pipeline)
        print('Patch 3: request tier added to pipeline (2nd attempt)')
    else:
        print('Patch 3: already present')

# 4. Update system prompt to include 'request'
old_sys = '"request" in SYS_PROMPT'
if 'request' not in content.split('SYS_PROMPT')[1][:300]:
    old_prompt_part = 'meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards, other'
    new_prompt_part = 'meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards, request, other'
    if old_prompt_part in content:
        content = content.replace(old_prompt_part, new_prompt_part)
        print('Patch 4: system prompt updated')
    else:
        print('Patch 4: prompt line not found')
else:
    print('Patch 4: already present')

# Upload
with sftp.open(remote, 'w') as f:
    f.write(content.encode('utf-8'))
run(f'chown intellimail:intellimail {remote}')
print('Uploaded main.py')

sftp.close()
ssh.close()
print('FastAPI patch done.')
