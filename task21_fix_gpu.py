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

# Check if GPU Ollama is reachable from staging
print('=== Ping GPU machine from staging ===')
print(run('curl -s --max-time 5 http://10.11.13.179:11434/api/tags 2>&1 | head -c 200'))

print()
print('=== Current PM2 env for classifier ===')
print(run('pm2 env intellimail-classifier 2>/dev/null | grep -i "ollama\|base_url\|model" | head -20'))

print()
print('=== ecosystem.config.js for classifier ===')
print(run('cat /opt/intellimail-classifier/ecosystem.config.js 2>/dev/null || cat /opt/intellimail-classifier/api/ecosystem.config.js 2>/dev/null || echo "not found"'))

ssh.close()
