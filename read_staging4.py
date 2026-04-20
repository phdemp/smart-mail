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

DB = '/home/AjayData/xgen-intel/intellimail/intellimail.db'

print('=== Classification breakdown ===')
print(run(f'sqlite3 {DB} "SELECT category, COUNT(*) as cnt FROM classifications GROUP BY category ORDER BY cnt DESC"'))

print()
print('=== Total emails vs classified ===')
print(run(f'sqlite3 {DB} "SELECT (SELECT COUNT(*) FROM emails) as emails, (SELECT COUNT(*) FROM classifications) as classified"'))

print()
print('=== Sample training.jsonl (first 3 lines) ===')
print(run('head -3 /opt/intellimail-classifier/data/training.jsonl'))

print()
print('=== training.jsonl line count ===')
print(run('wc -l /opt/intellimail-classifier/data/training.jsonl'))

print()
print('=== Python version in venv ===')
print(run('/opt/intellimail-classifier/venv/bin/python --version'))

print()
print('=== Venv all packages ===')
print(run('/opt/intellimail-classifier/venv/bin/pip list 2>/dev/null'))

ssh.close()
