import paramiko, sys, time, json
sys.stdout.reconfigure(encoding='utf-8')

GPU  = '10.11.13.179'
PASS = 'Digl!@#$Data321'
MAIN = '/opt/intellimail-classifier/api/main.py'

# Try different ports
for port in [2222, 22, 2200, 8022]:
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(GPU, port=port, username='root', password=PASS, timeout=5)
        print(f'Connected on port {port}')
        break
    except Exception as e:
        print(f'  port {port}: {str(e)[:50]}')
        ssh = None

if not ssh:
    sys.exit('No SSH access found')

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

print(run('whoami'))
print(run(f"sed -i 's/\"num_predict\":600/\"num_predict\":60/; s/\"num_ctx\":2048/\"num_ctx\":512/' {MAIN}"))
print(run(f'grep -n "num_predict" {MAIN}'))
print(run('systemctl restart intellimail-classifier && echo restarted'))
time.sleep(4)
result = run(
    'curl -s --max-time 30 -X POST http://localhost:8765/classify '
    '-H "Content-Type: application/json" '
    '-d \'{"subject":"Catch up call this week?","from_address":"someone@company.com","preview":"Hey can we find time to chat?","email_id":"t1"}\' ',
    timeout=35
)
print(result)
try:
    d = json.loads(result)
    print(f'\n=> stage={d["stage"]} ms={d["processing_ms"]}ms')
except: pass

ssh.close()
