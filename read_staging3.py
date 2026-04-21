import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8')

HOST = '10.11.13.237'
USER = 'root'
PASS = 'Digl!@#$Data321'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    return out.read().decode('utf-8', errors='replace').strip()

# Check known locations for DB
print('=== DB locations ===')
print(run('ls -la /home/AjayData/xgen-intel/intellimail/*.db 2>/dev/null; ls -la /opt/intellimail/*.db 2>/dev/null; ls -la ~/intellimail.db 2>/dev/null'))

print()
print('=== PM2 app dir ===')
print(run('pm2 list 2>/dev/null | head -20'))

print()
print('=== Node app location ===')
print(run('pm2 describe intellimail 2>/dev/null | grep -i "exec path\|cwd\|script"'))

print()
print('=== venv sklearn ===')
print(run('/opt/intellimail-classifier/venv/bin/pip list 2>/dev/null | grep -iE "sklearn|scikit|numpy|joblib"'))

print()
print('=== data dir ===')
print(run('ls /opt/intellimail-classifier/data/ 2>/dev/null || echo empty'))

ssh.close()
