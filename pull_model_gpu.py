import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

GPU = '10.11.13.179'

print('=== Triggering model pull on GPU Ollama (background) ===')
print('Model: qwen2.5:7b (~4.7GB, will take a few minutes)')

# Fire pull in background — streaming response, just kick it off
result = run(
    f'nohup curl -s -X POST http://{GPU}:11434/api/pull '
    f'-H "Content-Type: application/json" '
    f'-d \'{{"name":"qwen2.5:7b","stream":false}}\' '
    f'> /tmp/gpu_pull.log 2>&1 &',
    timeout=10
)
print(f'Pull started in background. PID check: {result}')

print()
print('Waiting 10 seconds then checking progress...')
time.sleep(10)

print()
print('=== Pull log so far ===')
print(run('tail -5 /tmp/gpu_pull.log 2>/dev/null || echo "log not yet written"'))

print()
print('=== Models on GPU now ===')
print(run(f'curl -s --max-time 5 http://{GPU}:11434/api/tags'))

ssh.close()
print()
print('Pull is running in background on staging server.')
print('Run check_gpu_pull.py in a minute to see progress.')
