import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Find the parse_json / JSON extraction code
print('=== JSON parsing area in main.py ===')
print(run('grep -n "parse_json\|json.loads\|Bad JSON\|strip\|fence\|markdown\|```" /opt/intellimail-classifier/api/main.py | head -30'))

print()
print('=== Lines around json.loads call ===')
print(run('grep -n "json.loads" /opt/intellimail-classifier/api/main.py'))

ssh.close()
