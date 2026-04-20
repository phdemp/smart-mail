import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Read current service file
print('=== Current service file ===')
svc = run('cat /etc/systemd/system/intellimail-classifier.service')
print(svc)

print()
# Check if Environment line already exists or needs to be added
if 'OLLAMA_BASE_URL' in svc:
    print('[already has OLLAMA_BASE_URL - updating]')
    print(run("sed -i 's|OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://10.11.13.179:11434|' /etc/systemd/system/intellimail-classifier.service"))
else:
    # Add Environment line after [Service] section or after existing Environment lines
    print('[adding OLLAMA_BASE_URL to service]')
    # Insert after the line containing "WorkingDirectory" or after [Service]
    print(run(r"sed -i '/^\[Service\]/a Environment=OLLAMA_BASE_URL=http://10.11.13.179:11434' /etc/systemd/system/intellimail-classifier.service"))

print()
print('=== Updated service file ===')
print(run('cat /etc/systemd/system/intellimail-classifier.service'))

print()
print('=== Reload + restart ===')
print(run('systemctl daemon-reload && systemctl restart intellimail-classifier', timeout=15))

import time
time.sleep(3)
print(run('systemctl is-active intellimail-classifier'))

print()
print('=== Test /health after restart ===')
print(run('curl -s --max-time 5 http://localhost:8765/health'))

ssh.close()
