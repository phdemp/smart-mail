import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

print('=== Models on staging Ollama ===')
print(run('curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; [print(m[\"name\"]) for m in json.load(sys.stdin)[\"models\"]]"'))

print()
print('=== FastAPI config on GPU machine (env vars) ===')
print(run('cat /opt/intellimail-classifier/api/.env 2>/dev/null || echo "no .env file"'))
print(run('grep -r "OLLAMA_MODEL\|intellimail-qwen" /opt/intellimail-classifier/ 2>/dev/null | grep -v ".pyc"'))

print()
print('=== How GPU FastAPI is started ===')
print(run('cat /etc/systemd/system/intellimail-classifier.service 2>/dev/null || ps aux | grep uvicorn'))

ssh.close()
