import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return (o + ('\nERR: ' + e if e else ''))

print('=== Ping (confirm reachable) ===')
print(run('ping -c 2 -W 2 10.11.13.179 2>&1'))

print()
print('=== TCP port 11434 test (timeout 3s) ===')
print(run('timeout 3 bash -c "echo >/dev/tcp/10.11.13.179/11434" && echo "PORT OPEN" || echo "PORT CLOSED/FILTERED"'))

print()
print('=== Try common ports to see what is open ===')
for port in [80, 443, 8080, 11434, 11435]:
    o, _ = ssh.exec_command(f'timeout 2 bash -c "echo >/dev/tcp/10.11.13.179/{port}" 2>/dev/null', timeout=5)
    result = "OPEN" if o.channel.recv_exit_status() == 0 else "closed"
    print(f'  port {port}: {result}')

ssh.close()
