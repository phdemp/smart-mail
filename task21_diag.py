import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Check tfidf model file exists
print('=== TF-IDF model file ===')
print(run('ls -lh /opt/intellimail-classifier/data/tfidf_model.joblib 2>&1'))

# Check main.py has tfidf integrated
print()
print('=== main.py tfidf lines ===')
print(run('grep -n tfidf /opt/intellimail-classifier/api/main.py'))

# Try meeting email with longer timeout
print()
print('=== Test meeting (30s timeout) ===')
payload = '{"subject":"Team sync tomorrow 3pm","body":"Please join the meeting at 3pm","from_address":"boss@corp.com"}'
r = run(f"curl -s --max-time 25 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload}'", timeout=30)
print(r or '(empty - timed out)')

# Try fyi email (no rule match, no travel/financial keywords)
print()
print('=== Test FYI (no rule match) ===')
payload2 = '{"subject":"Company newsletter March 2026","body":"This month at the company: new hires, quarterly review, team events and updates.","from_address":"hr@corp.com"}'
r2 = run(f"curl -s --max-time 25 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload2}'", timeout=30)
print(r2 or '(empty - timed out)')

print()
print('=== PM2 logs (last 20 lines) ===')
print(run('pm2 logs intellimail-classifier --lines 20 --nostream 2>/dev/null'))

ssh.close()
