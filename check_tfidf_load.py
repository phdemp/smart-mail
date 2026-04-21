import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

print('=== Service status ===')
print(run('systemctl is-active intellimail-classifier'))
print(run('systemctl status intellimail-classifier 2>/dev/null | grep -E "Active|ago|PID"'))

print()
print('=== Model file timestamp on staging ===')
print(run('ls -lh /opt/intellimail-classifier/data/tfidf_model.joblib'))

print()
print('=== Last log lines ===')
print(run('tail -8 /var/log/intellimail/api.log'))

print()
print('=== Health ===')
r = run('curl -s --max-time 5 http://localhost:8765/health')
try:
    h = json.loads(r)
    print(f'  status={h["status"]}')
    print(f'  stage_counts={h["stats"]["stage_counts"]}')
except:
    print(r[:200])

# If service stopped, restart it
is_active = run('systemctl is-active intellimail-classifier')
if is_active != 'active':
    print()
    print('=== Service not active — restarting ===')
    print(run('systemctl restart intellimail-classifier'))
    import time; time.sleep(5)
    print(run('systemctl is-active intellimail-classifier'))

ssh.close()
