import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Fix the malformed line using Python to rewrite the file cleanly
fix_cmd = r"""python3 -c "
import re
with open('/etc/systemd/system/intellimail-classifier.service','r') as f:
    content = f.read()
# Fix broken line - replace partial/broken OLLAMA_BASE_URL line
content = re.sub(
    r'Environment=\"OLLAMA_BASE_URL=[^\n\"]*\"?',
    'Environment=\"OLLAMA_BASE_URL=http://10.11.13.179:11434\"',
    content
)
with open('/etc/systemd/system/intellimail-classifier.service','w') as f:
    f.write(content)
print('fixed')
"
"""
print('=== Fixing service file ===')
print(run(fix_cmd))

print()
print('=== Verify OLLAMA line ===')
print(run('grep OLLAMA /etc/systemd/system/intellimail-classifier.service'))

print()
print('=== Reload + restart ===')
print(run('systemctl daemon-reload && systemctl restart intellimail-classifier'))

time.sleep(4)
print(run('systemctl is-active intellimail-classifier'))

print()
print('=== /health check ===')
print(run('curl -s --max-time 5 http://localhost:8765/health'))

ssh.close()
