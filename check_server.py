import paramiko

HOST = '10.11.13.237'
USER = 'root'
PASS = 'Digl!@#$Data321'
REMOTE_DIR = '/home/AjayData/xgen-intel/intellimail'

def run(ssh, cmd):
    _, out, err = ssh.exec_command(cmd)
    o = out.read().decode().strip()
    e = err.read().decode().strip()
    if o: print(o)
    if e and 'warn' not in e.lower(): print('ERR:', e)
    return o

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)
print('=== OS ===')
run(ssh, 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || uname -a')
print('\n=== Package Manager ===')
run(ssh, 'which yum || which dnf || which zypper || which apk || which apt-get || echo none')
print('\n=== Resources ===')
run(ssh, 'free -h && df -h /')
print('\n=== Internet ===')
run(ssh, 'curl -s --max-time 5 https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz --head | head -1')
ssh.close()
