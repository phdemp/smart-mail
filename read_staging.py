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

print('=== FastAPI main.py ===')
print(run('cat /opt/intellimail-classifier/api/main.py'))

print()
print('=== DB classification stats ===')
DB = '/home/AjayData/xgen-intel/intellimail/intellimail.db'
print(run(f'sqlite3 {DB} "SELECT category, COUNT(*) FROM classifications GROUP BY category ORDER BY COUNT(*) DESC"'))

print()
print('=== Total ===')
print(run(f'sqlite3 {DB} "SELECT COUNT(*) as total_emails FROM emails"'))
print(run(f'sqlite3 {DB} "SELECT COUNT(*) as total_classified FROM classifications"'))

print()
print('=== sklearn installed? ===')
print(run('pip3 list 2>/dev/null | grep -iE "sklearn|scikit|scipy|numpy|joblib"'))

print()
print('=== Classifier service dir ===')
print(run('ls /opt/intellimail-classifier/'))

ssh.close()
