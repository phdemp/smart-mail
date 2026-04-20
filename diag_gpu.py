import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return (o + (' | ERR: ' + e if e else ''))

print('=== Ping GPU machine ===')
print(run('ping -c 3 -W 2 10.11.13.179 2>&1'))

print()
print('=== TCP port check (nc) ===')
print(run('nc -zv -w 3 10.11.13.179 11434 2>&1'))

print()
print('=== curl verbose ===')
print(run('curl -v --max-time 5 http://10.11.13.179:11434/api/version 2>&1'))

print()
print('=== curl from THIS machine (local Ollama if any) ===')
print(run('curl -s --max-time 3 http://127.0.0.1:11434/api/version 2>&1'))

ssh.close()
