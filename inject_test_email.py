import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

DB = '/home/AjayData/xgen-intel/intellimail/intellimail.db'

# Insert a test email with NO classification (so it shows as pending)
print('=== Inserting test email (no classification) ===')
result = run(f'''node -e "
const {{ db }} = require('./src/db');
const r = db.prepare(\`
  INSERT INTO emails (message_id, uid, folder, from_address, from_name, to_address, subject, body_text, received_at, is_read)
  VALUES (?, ?, 'INBOX', ?, ?, '', ?, ?, datetime('now'), 0)
\`).run(
  'test-async-' + Date.now(),
  String(Date.now()),
  'cfo@bigcompany.com',
  'Raj Sharma',
  'Q3 Invoice #INV-2026-089 - Amount Due Rs 45,000',
  'Please find attached invoice for services rendered in Q3. Amount due Rs 45,000 by March 20. GST included.'
);
console.log('inserted id:', r.lastInsertRowid);
" 2>&1''' , timeout=15)
print(result)

email_id = None
for line in result.split('\n'):
    if 'inserted id:' in line:
        email_id = line.split(':')[-1].strip()
        break

if not email_id:
    print('Could not get email ID')
    ssh.close()
    exit()

print(f'Email ID: {email_id}')
print()
print('=== Email is now in DB with NO classification ===')
print('(Dashboard will show "Classifying..." badge)')
print()
print('=== Triggering classification via Node.js ===')
result = run(f'''node -e "
const {{ queueClassification }} = require('./src/classifier');
queueClassification({email_id});
setTimeout(() => {{ console.log('queued'); process.exit(0); }}, 500);
" 2>&1''', timeout=10)
print(result)

print()
print('Waiting 5s for GPU to classify...')
time.sleep(5)

print()
print('=== Check classification result ===')
result = run(f'''node -e "
const {{ db }} = require('./src/db');
const c = db.prepare('SELECT * FROM classifications WHERE email_id = ?').get({email_id});
if (c) {{
  console.log('category:', c.category);
  console.log('urgency:', c.urgency);
  console.log('summary:', c.summary);
}} else {{
  console.log('still classifying...');
}}
" 2>&1''', timeout=10)
print(result)

ssh.close()
