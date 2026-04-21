import paramiko, sys, time, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

MAIN = '/opt/intellimail-classifier/api/main.py'
GPU  = '10.11.13.179'

# Also reduce num_ctx 2048 -> 512 on staging
print('=== Reduce num_ctx 2048 -> 512 on staging ===')
print(run(f"sed -i 's/\"num_ctx\":2048/\"num_ctx\":512/' {MAIN}"))
print(run(f'grep -n "num_predict\|num_ctx" {MAIN} | head -3'))
print(run('systemctl restart intellimail-classifier && sleep 3 && echo restarted'))

# Speed test on staging FastAPI
print()
print('=== Speed test on staging FastAPI (LLM path) ===')
result = run(
    'curl -s --max-time 30 -X POST http://localhost:8765/classify '
    '-H "Content-Type: application/json" '
    '-d \'{"subject":"Quick question about the project roadmap","from_address":"colleague@company.com","preview":"Wanted your thoughts on Q2 priorities.","email_id":"speed_test"}\' ',
    timeout=35
)
print(result)
try:
    d = json.loads(result)
    print(f'\n  => stage={d["stage"]} ms={d["processing_ms"]}ms category={d["category"]}')
except: pass

# Now apply same changes to GPU FastAPI main.py
print()
print('=== Download updated main.py and show GPU instructions ===')
# Download the updated staging main.py
sftp = ssh.open_sftp()
sftp.get(MAIN, r'I:\xgen-intel\intellimail\main_gpu_updated.py')
sftp.close()
print('  Updated main.py saved locally as main_gpu_updated.py')

ssh.close()
