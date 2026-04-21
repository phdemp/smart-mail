import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

# Connect directly to GPU machine
HOST = '10.11.13.179'
USER = 'root'
PASS = 'Digl!@#$Data321'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

print('=== Connected to GPU machine ===')
print(run('uname -a && hostname'))

print()
print('=== Ollama models available ===')
print(run('curl -s http://localhost:11434/api/tags'))

print()
print('=== Create alias: qwen2.5:7b -> intellimail-qwen ===')
print(run('ollama cp qwen2.5:7b intellimail-qwen 2>&1', timeout=30))

print()
print('=== Verify model created ===')
print(run('curl -s http://localhost:11434/api/tags'))

print()
print('=== Restart FastAPI service ===')
print(run('systemctl restart intellimail-classifier 2>&1 && echo "restarted OK"'))

import time; time.sleep(4)

print()
print('=== Health check after restart ===')
print(run('curl -s http://localhost:8765/health'))

ssh.close()
