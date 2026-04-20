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

# Read lines 1-20 to see if SYS_PROMPT already defined
print('=== Check for SYS_PROMPT in main.py ===')
print(run('grep -n "SYS_PROMPT\|system.*message\|system.*prompt\|SYSTEM" /opt/intellimail-classifier/api/main.py | head -10'))

# Read the full call_llm to understand what to patch
print()
print('=== call_llm function (lines 250-280) ===')
print(run('sed -n "250,282p" /opt/intellimail-classifier/api/main.py'))

ssh.close()
