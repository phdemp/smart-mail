import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

APP = '/home/AjayData/xgen-intel/intellimail'
DB  = f'{APP}/intellimail.db'

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Insert test email directly via sqlite3
print('=== Insert test email (no classification) ===')
sql = "INSERT INTO emails (message_id, uid, folder, from_address, from_name, to_address, subject, body_text, received_at, is_read) VALUES ('test-async-123', '99999', 'INBOX', 'cfo@bigcompany.com', 'Raj Sharma', '', 'Q3 Invoice INV-2026-089 Amount Due Rs 45000', 'Invoice for Q3 services. Amount due Rs 45000 by March 20. GST included.', datetime('now'), 0);"
print(run(f"sqlite3 {DB} \"{sql}\""))

email_id = run(f"sqlite3 {DB} \"SELECT id FROM emails WHERE message_id='test-async-123' LIMIT 1\"")
print(f'Email ID: {email_id}')

print()
print('=== Triggering classification via Node.js API ===')
result = run(f'''cd {APP} && node -e "const {{queueClassification}}=require('./src/classifier'); queueClassification({email_id}); setTimeout(()=>process.exit(0),1000);" 2>&1''', timeout=15)
print(result or '(no output = queued successfully)')

print()
print('Waiting 8s for GPU classification...')
time.sleep(8)

print()
print('=== Classification result ===')
cls = run(f"sqlite3 {DB} \"SELECT category, urgency, summary FROM classifications WHERE email_id={email_id}\"")
print(cls or 'still classifying...')

print()
print('=== PM2 recent stdout (classification_done should appear) ===')
print(run(f'pm2 logs intellimail --lines 8 --nostream 2>/dev/null | grep -v "Circuit\|TAILING\|pm2"'))

ssh.close()
