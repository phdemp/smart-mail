import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Find the process listening on 8765
print('=== Process on port 8765 ===')
print(run('ss -tlnp sport 8765 2>/dev/null || netstat -tlnp 2>/dev/null | grep 8765'))

print()
print('=== Find uvicorn/gunicorn process ===')
print(run('ps aux | grep -E "uvicorn|gunicorn|python.*main" | grep -v grep'))

print()
print('=== systemd service for classifier ===')
print(run('systemctl list-units --type=service 2>/dev/null | grep -iE "class|intelli|mail"'))
print(run('systemctl status intellimail-classifier 2>/dev/null | head -20'))

print()
print('=== Check which main.py is used ===')
print(run('ls -la /opt/intellimail-classifier/main.py /opt/intellimail-classifier/api/main.py 2>&1'))
print(run('head -5 /opt/intellimail-classifier/main.py 2>/dev/null'))

ssh.close()
