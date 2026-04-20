import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

# Connect to staging first
ssh_staging = paramiko.SSHClient()
ssh_staging.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh_staging.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run_staging(cmd, timeout=30):
    _, out, err = ssh_staging.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

GPU = '10.11.13.179'

# Try SSH from staging to GPU with various usernames
print('=== Try SSH from staging to GPU machine ===')
for user in ['root', 'ajay', 'AjayData', 'administrator', 'intellimail']:
    result = run_staging(f'sshpass -p "Digl!@#$Data321" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 {user}@{GPU} "echo OK:{user}" 2>&1')
    print(f'  {user}: {result}')
    if 'OK:' in result:
        print(f'  => SUCCESS with user={user}')
        break

print()
print('=== Alternative: run ollama cp via curl API on GPU ===')
# Ollama has a /api/copy endpoint
result = run_staging(f'''curl -s -X POST http://{GPU}:11434/api/copy \
  -H "Content-Type: application/json" \
  -d \'{{"source":"qwen2.5:7b","destination":"intellimail-qwen"}}\' ''')
print(result or '(empty response = success)')

time.sleep(3)

print()
print('=== Verify models on GPU ===')
print(run_staging(f'curl -s http://{GPU}:11434/api/tags'))

print()
print('=== Health check GPU FastAPI ===')
print(run_staging(f'curl -s http://{GPU}:8765/health'))

ssh_staging.close()
