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
    return out.read().decode('utf-8', errors='replace').strip()

# Find the actual DB path
print('=== Find DB ===')
print(run('find / -name "intellimail.db" 2>/dev/null'))

print()
print('=== Classifier venv packages ===')
print(run('/opt/intellimail-classifier/venv/bin/pip list 2>/dev/null | grep -iE "sklearn|scikit|scipy|numpy|joblib|pandas"'))

print()
print('=== Data dir contents ===')
print(run('ls -la /opt/intellimail-classifier/data/ 2>/dev/null || echo "empty or missing"'))

print()
print('=== finetune dir ===')
print(run('ls -la /opt/intellimail-classifier/finetune/ 2>/dev/null'))

ssh.close()
