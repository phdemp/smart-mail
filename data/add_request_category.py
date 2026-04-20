"""
Adds 'request' category to TF-IDF model.
Pulls labeled examples from staging DB + existing auto-labeled data, retrains, deploys.
"""
import paramiko, sys, json, os, re, random
sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(DATA_DIR, 'tfidf_model.joblib')

# ── Pull "request" examples from staging DB other emails ─────────────────────
def pull_request_emails_from_db():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
    APP = '/home/AjayData/xgen-intel/intellimail'

    def run(cmd, timeout=15):
        _, o, e = ssh.exec_command(cmd, timeout=timeout)
        return (o.read() + e.read()).decode('utf-8', errors='replace').strip()

    sftp = ssh.open_sftp()
    script = """const {db} = require('./src/db');
const rows = db.prepare('SELECT e.subject, e.from_address, e.body_text FROM emails e JOIN classifications c ON c.email_id = e.id WHERE c.category = ? ORDER BY e.received_at DESC LIMIT 400').all('other');
console.log(JSON.stringify(rows));"""
    with sftp.open(f'{APP}/dump_others2.js', 'w') as f:
        f.write(script.encode('utf-8'))
    sftp.close()

    raw = run(f'cd {APP} && node dump_others2.js 2>&1', timeout=15)
    ssh.close()

    emails = json.loads(raw)
    request_examples = []
    for e in emails:
        if _is_request(e['subject'], e.get('from_address',''), e.get('body_text','')):
            request_examples.append({
                'subject': e['subject'],
                'body': (e.get('body_text') or '')[:400],
                'from': e.get('from_address',''),
                'category': 'request'
            })
    print(f'  Pulled {len(request_examples)} request examples from staging DB')
    return request_examples

def _is_request(subject, from_addr, body):
    sub  = (subject   or '').lower()
    body = (body      or '')[:400].lower()
    all_ = sub + ' ' + body
    # HR
    if re.search(r'leave|holiday|gate pass|attendance|payroll|salary slip|timesheet|appraisal|increment|resignation|relieving|wfh|work from home', sub): return True
    if re.search(r'leave approval|restricted holiday|casual leave|sick leave|half day|comp off', all_): return True
    # Approval / signing
    if re.search(r'approval|approve|digital sign|signature|esign|countersign|authorization|sanction|performance allowance', sub): return True
    # Procurement
    if re.search(r'purchase order|\bpo\b|rfq|quotation|sfp|transceiver|fiber|kvm|ups|router|switch.*order|server.*order|hardware.*order|procurement|indent|material.*request', sub): return True
    return False

# ── Load existing labeled_training.jsonl ─────────────────────────────────────
def load_existing():
    path = os.path.join(DATA_DIR, 'labeled_training.jsonl')
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                d = json.loads(line)
                rows.append({'subject': d.get('subject',''), 'body': d.get('body',''), 'from': d.get('from_address',''), 'category': d['category']})
            except: pass
    print(f'  Loaded {len(rows)} existing examples from labeled_training.jsonl')
    return rows

# ── Synthetic request examples ────────────────────────────────────────────────
def synthetic_request_examples():
    examples = [
        ("Request for Casual Leave - 2 days", "I would like to request 2 days casual leave from March 10 to March 11 for personal reasons. Please approve.", "employee@company.com"),
        ("Gate Pass Request - Visitor Entry", "Requesting gate pass for vendor visit on March 12 at 10 AM. Visitor: Rajesh Kumar from TechCorp.", "security@company.com"),
        ("Leave Approval Required: Sick Leave 3 days", "Sick leave application for 3 days. Medical certificate attached.", "hr@company.com"),
        ("Request for Performance Allowance Approval", "Please approve the performance allowance for Q3 as per attached calculation sheet.", "manager@dil.in"),
        ("Restricted Holiday Approval From Hemant Kumar", "Request for availing restricted holiday on March 15. Festival: Holi.", "hr@dil.in"),
        ("Attendance Regularization Request", "Requesting regularization of attendance for Feb 28 due to system issue.", "employee@corp.com"),
        ("WFH Approval Request for next week", "Requesting work from home approval for March 10-14 due to relocation.", "staff@company.com"),
        ("Purchase Order Request - UPS and Battery", "Please approve PO for 1000 VA UPS and 65 AH battery for Takiya ki Chouki node. Quoted price: Rs 12500.", "it@dil.in"),
        ("RFQ: 25G SFP Transceivers required urgently", "We require 10 units of 25G SFP transceivers and 10G dual fiber for MI Road DC. Request quotation.", "procurement@dil.in"),
        ("Approval Required: PDF Digital Signature February 2026", "Please digitally sign the attached salary certificate documents for February 2026.", "accounts@company.com"),
        ("Request for KVM Switch and USB LAN Card Purchase", "Requesting approval to purchase 1 KVM switch and 2 USB LAN cards for server room.", "infra@company.com"),
        ("Core Switch Upgrade Plan Approval - MI Road Data Center", "Requesting approval for core switch upgrade at MI Road DC. Total cost estimate: Rs 2.4 lakhs.", "it@dil.in"),
        ("Comp Off Request - Weekend Work March 8", "I worked on Saturday March 8 for the deployment. Requesting compensatory off on March 12.", "dev@company.com"),
        ("Half Day Leave Request - March 15 afternoon", "Requesting half day leave on March 15 afternoon for personal appointment.", "employee@company.com"),
        ("Material Indent Request - Office Supplies", "Requesting approval for office supplies indent: 10 reams paper, 5 printer cartridges, 2 staplers.", "admin@company.com"),
        ("Procurement Request: Network Cables and Fiber Patch Cords", "Request to procure 50m fiber patch cords and CAT6 cables for new office setup.", "infra@company.com"),
        ("Annual Increment Approval Request FY 2025-26", "Please approve the annual increment list for FY 2025-26 as per HR policy.", "hr@company.com"),
        ("Request for Resignation Acceptance - Priya Sharma", "Acknowledging resignation of Priya Sharma effective April 30. Requesting formal acceptance.", "hr@company.com"),
        ("Vendor Invoice Approval Required", "Invoice from ABC Suppliers for network equipment. Amount: Rs 45000. Please approve for payment.", "accounts@company.com"),
        ("Sanction Request: Server Hardware Replacement", "Requesting sanction for replacing 3 failed hard drives in production server. Quoted: Rs 18000.", "it@company.com"),
    ]
    return [{'subject': s, 'body': b, 'from': f, 'category': 'request'} for s, b, f in examples]

# ── Retrain with new category ─────────────────────────────────────────────────
def retrain(all_data):
    from sklearn.pipeline import Pipeline
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from collections import Counter
    import numpy as np, joblib

    texts  = [f"{d['subject']} {d.get('from','')} {d.get('body','')}".lower() for d in all_data]
    labels = [d['category'] for d in all_data]

    counts = Counter(labels)
    print(f'\n  Category counts: {dict(counts)}')

    model = Pipeline([
        ('tfidf', TfidfVectorizer(ngram_range=(1,2), max_features=30000, sublinear_tf=True, min_df=2, strip_accents='unicode')),
        ('clf',   LogisticRegression(C=5.0, max_iter=1000, class_weight='balanced', solver='lbfgs'))
    ])

    scores = cross_val_score(model, texts, labels, cv=5, scoring='accuracy')
    print(f'  Cross-val accuracy: {scores.mean():.1%} ± {scores.std():.1%}')
    model.fit(texts, labels)

    checks = [
        ('Request for Casual Leave 2 days personal reasons hr@company.com', 'request'),
        ('Gate Pass Request Visitor Entry vendor procurement@dil.in',        'request'),
        ('Purchase Order RFQ SFP transceivers fiber patch cords',            'request'),
        ('Pdf digital sign approval sanction authorization',                  'request'),
        ('Invoice Amount Due Rs 50000 vendor@company.com',                   'financial'),
        ('Team meeting agenda Friday 3pm manager@corp.com',                  'meeting_request'),
        ('PNR AI12345 Indigo flight confirmed noreply@goindigo.in',          'travel'),
        ('Contract renewal legal notice data infosys',                        'legal'),
        ('Newsletter monthly digest hr@company.com',                          'fyi'),
    ]
    print('\n  Sanity checks:')
    passed = 0
    for text, expected in checks:
        pred  = model.predict([text.lower()])[0]
        proba = model.predict_proba([text.lower()])[0].max()
        ok = '✓' if pred == expected else '✗'
        if pred == expected: passed += 1
        print(f'    {ok} {expected:20} → {pred:20} ({proba:.0%})')
    print(f'  {passed}/{len(checks)} checks passed')

    joblib.dump(model, MODEL_PATH)
    print(f'\n  Model saved → {MODEL_PATH}')
    return model

# ── Deploy ────────────────────────────────────────────────────────────────────
def deploy():
    import time
    print('\n  Deploying to staging...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
    sftp = ssh.open_sftp()
    sftp.put(MODEL_PATH, '/opt/intellimail-classifier/data/tfidf_model.joblib')
    sftp.close()
    def run(cmd):
        _, o, e = ssh.exec_command(cmd, timeout=15)
        return (o.read()+e.read()).decode('utf-8','replace').strip()
    run('chown intellimail:intellimail /opt/intellimail-classifier/data/tfidf_model.joblib')
    run('systemctl restart intellimail-classifier')
    time.sleep(4)
    print(f'  Service: {run("systemctl is-active intellimail-classifier")}')
    ssh.close()

if __name__ == '__main__':
    print('=== Step 1: Pull request emails from staging DB ===')
    db_examples = pull_request_emails_from_db()

    print('\n=== Step 2: Load existing training data ===')
    existing = load_existing()

    print('\n=== Step 3: Add synthetic request examples ===')
    synthetic = synthetic_request_examples()
    print(f'  {len(synthetic)} synthetic request examples added')

    all_data = existing + db_examples + synthetic
    random.seed(42); random.shuffle(all_data)
    print(f'  Total training examples: {len(all_data)}')

    print('\n=== Step 4: Retrain TF-IDF ===')
    retrain(all_data)

    print('\n=== Step 5: Deploy ===')
    deploy()
    print('\nDone.')
