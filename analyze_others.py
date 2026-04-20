import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

sftp = ssh.open_sftp()
script = """const {db} = require('./src/db');
const rows = db.prepare(
  'SELECT e.subject, e.from_address, e.body_text FROM emails e JOIN classifications c ON c.email_id = e.id WHERE c.category = ? ORDER BY e.received_at DESC LIMIT 354'
).all('other');
console.log(JSON.stringify(rows));
"""
with sftp.open(f'{APP}/dump_others.js', 'w') as f:
    f.write(script.encode('utf-8'))
sftp.close()

raw = run(f'cd {APP} && node dump_others.js 2>&1', timeout=15)
emails = json.loads(raw)

# Apply extended rule engine locally
import re

def extended_classify(subject, from_addr, body):
    sub  = (subject    or '').lower()
    frm  = (from_addr  or '').lower()
    body = (body       or '')[:400].lower()
    all_ = sub + ' ' + body

    # HR requests
    if re.search(r'leave|holiday|gate pass|attendance|payroll|salary slip|timesheet|onboarding|appraisal|increment|resignation|relieving', sub):
        return 'hr_request'
    if re.search(r'leave approval|restricted holiday|casual leave|sick leave|half day|comp off|wfh approval', all_):
        return 'hr_request'

    # IT support
    if re.search(r'deactivat|mail id|password|reset|vpn|server|domain.*expir|expir.*domain|certificate|ssl|firewall|backup|it support|helpdesk|ticket|incident', sub):
        return 'it_support'
    if re.search(r'system.*down|outage|maintenance|patch|upgrade.*system|software.*install|hardware.*issue|network.*issue', all_):
        return 'it_support'

    # Procurement
    if re.search(r'purchase order|po |rfq|quotation|vendor|supplier|sfp|transceiver|fiber|cable|rack|ups|router|switch|server.*order|hardware.*order|procurement', sub):
        return 'procurement'
    if re.search(r'rate.*quoted|price.*quote|supply.*order|indent|material.*request', all_):
        return 'procurement'

    # Approval / document signing
    if re.search(r'approval|approve|sign|digital sign|signature|esign|countersign|authorization|sanction', sub):
        return 'approval_request'

    # Project / task updates
    if re.search(r'jira|github|gitlab|bitbucket|sprint|milestone|deployment|release|pull request|merge|build|pipeline|jenkins|ci/cd|task.*assigned|ticket.*update', sub):
        return 'project_update'
    if re.search(r'project.*update|status.*update|progress.*report|daily.*standup|scrum', all_):
        return 'project_update'

    # Recruitment
    if re.search(r'job|interview|candidate|resume|cv|offer letter|joining|recruitment|hire|applicant|shortlist', sub):
        return 'recruitment'

    # Customer / escalation
    if re.search(r'complaint|escalat|ticket|support.*request|refund|issue.*report|customer.*problem|sla.*breach', sub):
        return 'customer_complaint'

    # Vendor / supplier comms
    if re.search(r'renewal|subscription.*due|maintenance.*contract|amc|annual.*contract|service.*expir', sub):
        return 'vendor_contract'

    # Security / compliance
    if re.search(r'security|audit|compliance|gdpr|iso|vulnerability|phishing|malware|alert.*security|breach', sub):
        return 'security_compliance'

    return None

# Tally
tally = {}
samples = {}
for e in emails:
    cat = extended_classify(e['subject'], e['from_address'], e.get('body_text',''))
    if cat:
        tally[cat] = tally.get(cat, 0) + 1
        if cat not in samples:
            samples[cat] = []
        if len(samples[cat]) < 3:
            samples[cat].append(e['subject'][:80])

still_other = len(emails) - sum(tally.values())

print(f'=== Analysing {len(emails)} "other" emails ===\n')
print(f'{"Category":<22} {"Count":>6}   Sample subjects')
print('-' * 90)
for cat, n in sorted(tally.items(), key=lambda x: -x[1]):
    print(f'{cat:<22} {n:>6}')
    for s in samples[cat]:
        print(f'  {"":22}   → {s}')
print('-' * 90)
print(f'{"still unclassifiable":<22} {still_other:>6}   (true "other")')
print()
print(f'Rescuable from "other": {sum(tally.values())} / {len(emails)} ({sum(tally.values())/len(emails):.0%})')

ssh.close()
