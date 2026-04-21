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

print('=== PM2 status ===')
print(run('pm2 list 2>/dev/null | grep intellimail'))

print()
print('=== Recent logs (last 15 lines) ===')
print(run('pm2 logs intellimail --lines 15 --nostream 2>/dev/null'))

print()
print('=== GPU FastAPI health ===')
r = run('curl -s --max-time 5 http://10.11.13.179:8765/health')
try:
    h = json.loads(r)
    s = h['stats']
    print(f"  status: {h['status']} | model: {h['model']}")
    print(f"  stages: {s['stage_counts']}")
    print(f"  avg_latency: {s['avg_latency_ms']}ms | total_requests: {s['requests_total']}")
except:
    print(r)

print()
print('=== IMAP sync mode ===')
print(run('curl -s --max-time 5 http://localhost:3099/api/sync-status 2>/dev/null || echo "check logs"'))

ssh.close()
