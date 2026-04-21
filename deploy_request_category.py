import paramiko, sys, time, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
sftp = ssh.open_sftp()

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=20):
    _, o, e = ssh.exec_command(cmd, timeout=timeout)
    return (o.read()+e.read()).decode('utf-8','replace').strip()

# Upload Node.js files
print('Uploading Node.js files...')
sftp.put(r'I:\xgen-intel\intellimail\src\routes\api.js',     f'{APP}/src/routes/api.js')
sftp.put(r'I:\xgen-intel\intellimail\public\js\app.js',      f'{APP}/public/js/app.js')
sftp.put(r'I:\xgen-intel\intellimail\public\css\app.css',    f'{APP}/public/css/app.css')
sftp.close()
print('Done.')

# Restart FastAPI
print('\nRestarting FastAPI...')
run('systemctl restart intellimail-classifier')
time.sleep(4)
print(f'  classifier: {run("systemctl is-active intellimail-classifier")}')

# Restart Node.js
print('Restarting IntelliMail PM2...')
run(f'cd {APP} && pm2 restart intellimail 2>&1')
time.sleep(3)
print(f'  intellimail: {run("pm2 list 2>/dev/null | grep intellimail | awk \"{print $18}\"")}')

# Quick classification test for request category
print()
print('=== Test: request category ===')
tests = [
    ('hr_request',       'Request for Casual Leave 2 days March 10-11', 'I need casual leave for personal reasons. Please approve.', 'employee@dil.in'),
    ('procurement',      'Purchase Order RFQ: UPS 1000VA and 65AH Battery', 'Requesting approval for UPS purchase for server room. Quoted Rs 12500.', 'it@dil.in'),
    ('approval',         'Pdf digital sign approval February 2026 salary documents', 'Please sign the attached salary certificate documents.', 'accounts@dil.in'),
    ('financial check',  'Invoice INV-2026-099 Amount Due Rs 75000', 'Payment due by March 20. GST included.', 'vendor@company.com'),
    ('meeting check',    'Team meeting Q1 review Friday 3pm agenda', 'Please join the Q1 review meeting on Friday at 3pm in room 4B.', 'manager@corp.com'),
]
for label, sub, preview, frm in tests:
    payload = json.dumps({"subject": sub, "preview": preview, "from_address": frm})
    payload = payload.replace("'", "'\\''")
    r = run(f"curl -s --max-time 15 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload}'", timeout=20)
    try:
        c = json.loads(r)
        print(f'  [{label:16}] category={c["category"]:16} stage={c["stage"]}')
    except:
        print(f'  [{label:16}] FAILED: {r[:60]}')

# Check stage counts
print()
print('=== /health stage counts ===')
r = run('curl -s --max-time 5 http://localhost:8765/health')
try:
    h = json.loads(r)
    print(f'  stage_counts: {h["stats"]["stage_counts"]}')
except:
    print(r[:100])

ssh.close()
print('\nDeployment complete.')
