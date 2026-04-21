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

print('=== Pull process running? ===')
print(run('ps aux | grep "api/pull" | grep -v grep'))

print()
print('=== Pull log ===')
print(run('cat /tmp/gpu_pull.log 2>/dev/null || echo "no log yet"'))

print()
print('=== Models on GPU ===')
print(run(f'curl -s --max-time 5 http://{GPU}:11434/api/tags'))

# If no models still, try a streaming pull to see what happens
print()
print('=== Trying streaming pull to see progress ===')
print(run(
    f'curl -s --max-time 20 -X POST http://{GPU}:11434/api/pull '
    f'-H "Content-Type: application/json" '
    f'-d \'{{"name":"qwen2.5:7b","stream":true}}\' 2>&1 | head -10',
    timeout=25
))

ssh.close()
