import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Find how classifier is started via PM2
print('=== PM2 list ===')
print(run('pm2 list 2>/dev/null'))

print()
print('=== PM2 show intellimail-classifier ===')
print(run('pm2 show intellimail-classifier 2>/dev/null | head -30'))

print()
print('=== Check for start script / env files ===')
print(run('ls /opt/intellimail-classifier/ 2>/dev/null'))
print(run('ls /opt/intellimail-classifier/api/ 2>/dev/null'))

print()
print('=== Look for .env file ===')
print(run('cat /opt/intellimail-classifier/.env 2>/dev/null || cat /opt/intellimail-classifier/api/.env 2>/dev/null || echo "no .env found"'))

ssh.close()
