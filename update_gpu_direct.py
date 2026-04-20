import paramiko, sys, time, json
sys.stdout.reconfigure(encoding='utf-8')

GPU  = '10.11.13.179'
PASS = 'Digl!@#$Data321'
MAIN = '/opt/intellimail-classifier/api/main.py'

# Try different usernames
for user in ['root', 'ajay', 'AjayData', 'intellimail', 'ubuntu', 'user']:
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(GPU, username=user, password=PASS, timeout=5)
        print(f'Connected as: {user}')
        break
    except Exception as e:
        print(f'  {user}: {str(e)[:60]}')
        ssh = None

if not ssh:
    sys.exit('Could not connect to GPU machine')

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

print(run('whoami && uname -a'))

print()
print('=== Apply num_predict=60 and num_ctx=512 ===')
print(run(f"sed -i 's/\"num_predict\":600/\"num_predict\":60/' {MAIN}"))
print(run(f"sed -i 's/\"num_predict\": 600/\"num_predict\": 60/' {MAIN}"))
print(run(f"sed -i 's/\"num_ctx\":2048/\"num_ctx\":512/' {MAIN}"))
print(run(f"sed -i 's/\"num_ctx\": 2048/\"num_ctx\": 512/' {MAIN}"))

print()
print('=== Verify ===')
print(run(f'grep -n "num_predict\|num_ctx" {MAIN} | head -3'))

print()
print('=== Restart FastAPI ===')
print(run('systemctl restart intellimail-classifier && sleep 3 && echo restarted'))

print()
print('=== Speed test (LLM path) ===')
result = run(
    'time curl -s --max-time 30 -X POST http://localhost:8765/classify '
    '-H "Content-Type: application/json" '
    '-d \'{"subject":"Follow up on our discussion last week","from_address":"contact@partner.com","preview":"Wanted to check in on where things stand.","email_id":"spd1"}\' ',
    timeout=35
)
print(result)
try:
    for line in result.split('\n'):
        if line.strip().startswith('{'):
            d = json.loads(line.strip())
            print(f'\n  => stage={d["stage"]} ms={d["processing_ms"]}ms category={d["category"]}')
            break
except: pass

ssh.close()
