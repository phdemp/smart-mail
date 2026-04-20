import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=90):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

GPU = '10.11.13.179'

print('=== 1. Ollama version ===')
print(run(f'curl -s --max-time 5 http://{GPU}:11434/api/version'))

print()
print('=== 2. Ollama models available ===')
print(run(f'curl -s --max-time 5 http://{GPU}:11434/api/tags'))

print()
print('=== 3. FastAPI /health ===')
print(run(f'curl -s --max-time 5 http://{GPU}:8765/health'))

print()
print('=== 4. FastAPI classify - travel email ===')
r = run(f'''curl -s --max-time 10 -X POST http://{GPU}:8765/classify \
  -H "Content-Type: application/json" \
  -d \'{{"subject":"IndiGo Booking Confirmation PNR ABC123","from_address":"noreply@goindigo.in","from_name":"IndiGo","preview":"Your flight DEL-BOM on March 15 is confirmed.","email_id":"t1"}}\' ''')
print(r)
try:
    d = json.loads(r)
    print(f'  => category={d.get("category")} stage={d.get("stage")} ms={d.get("processing_ms")}')
except: pass

print()
print('=== 5. FastAPI classify - meeting email ===')
r = run(f'''curl -s --max-time 10 -X POST http://{GPU}:8765/classify \
  -H "Content-Type: application/json" \
  -d \'{{"subject":"Meeting Request: Zoom call Friday 3pm","from_address":"manager@company.com","preview":"Can we hop on a Zoom call Friday?","email_id":"t2"}}\' ''')
print(r)
try:
    d = json.loads(r)
    print(f'  => category={d.get("category")} stage={d.get("stage")} ms={d.get("processing_ms")}')
except: pass

print()
print('=== 6. SPEED TEST - LLM path email (ambiguous, forces LLM) ===')
print('Timing...')
r = run(f'''time curl -s --max-time 120 -X POST http://{GPU}:8765/classify \
  -H "Content-Type: application/json" \
  -d \'{{"subject":"Quick question about our project","from_address":"colleague@company.com","preview":"Hey, wanted to get your thoughts on the Q2 roadmap direction.","email_id":"t3"}}\' ''', timeout=125)
print(r)
try:
    lines = r.split('\n')
    for line in lines:
        if line.strip().startswith('{'):
            d = json.loads(line.strip())
            print(f'  => category={d.get("category")} stage={d.get("stage")} ms={d.get("processing_ms")}')
            break
except: pass

ssh.close()
