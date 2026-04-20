import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=25):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Read the system prompt from main.py
print('=== System prompt in main.py ===')
print(run('grep -n "SYSTEM\|system_prompt\|SYS_PROMPT\|prompt.*=" /opt/intellimail-classifier/api/main.py | head -10'))
print(run('sed -n "60,130p" /opt/intellimail-classifier/api/main.py | head -80'))

ssh.close()
