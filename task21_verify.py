import paramiko, sys, json, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

time.sleep(5)

print('=== Service status ===')
print(run('systemctl status intellimail-classifier 2>/dev/null | head -15'))

print()
print('=== /health ===')
r = run('curl -s --max-time 8 http://localhost:8765/health')
print(r)
try:
    h = json.loads(r)
    s = h['stats']
    print(f"\n  status: {h['status']} | model: {h['model']}")
    print(f"  stage_counts: {s['stage_counts']}")
    print(f"  ollama_connected: {h.get('ollama',{}).get('connected','?')}")
except:
    pass

print()
print('=== Last 10 log lines ===')
print(run('tail -10 /var/log/intellimail/api.log 2>/dev/null'))

ssh.close()
