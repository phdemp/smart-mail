import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8')

HOST = '10.11.13.237'
USER = 'root'
PASS = 'Digl!@#$Data321'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o, e

OLLAMA_GPU = 'http://10.11.13.179:11434'

print('=== 1. Basic connectivity ===')
o, e = run(f'curl -s --max-time 5 {OLLAMA_GPU}/api/version')
print(o or e)

print()
print('=== 2. List available models ===')
o, e = run(f'curl -s --max-time 10 {OLLAMA_GPU}/api/tags')
print(o or e)

print()
print('=== 3. Quick inference test (5 tokens) ===')
o, e = run(
    f'''curl -s --max-time 30 {OLLAMA_GPU}/api/generate -d \'{{"model":"intellimail-qwen","prompt":"Hello","stream":false,"options":{{"num_predict":5}}}}\' ''',
    timeout=35
)
print(o or e)

print()
print('=== 4. Speed test - classify email JSON (time it) ===')
o, e = run(
    r'''time curl -s --max-time 60 http://10.11.13.179:11434/api/chat -d '{"model":"intellimail-qwen","messages":[{"role":"user","content":"From: noreply@goindigo.in\nSubject: IndiGo Booking Confirmation PNR ABC123\n\nClassify this email as JSON: {\"category\": ..., \"urgency\": ...}"}],"stream":false,"options":{"num_predict":80,"temperature":0.05}}' ''',
    timeout=65
)
print(o or e)

ssh.close()
