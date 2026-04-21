import paramiko, os, urllib.request

HOST = '10.11.13.237'
USER = 'root'
PASS = 'Digl!@#$Data321'
REMOTE_DIR = '/home/AjayData/xgen-intel/intellimail'
NODE_VER = 'v22.14.0'
NODE_TAR = f'node-{NODE_VER}-linux-x64.tar.xz'
NODE_URL = f'https://nodejs.org/dist/{NODE_VER}/{NODE_TAR}'
LOCAL_TMP = os.path.join(os.environ.get('TEMP', '/tmp'), NODE_TAR)

def run(ssh, cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode().strip()
    e = err.read().decode().strip()
    if o: print(f'    {o}')
    if e and 'warn' not in e.lower() and 'deprecat' not in e.lower() and 'npm notice' not in e: print(f'    WARN: {e}')
    return o

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)
print('Connected to server')

# Check if node exists already
node_ver = run(ssh, 'node --version 2>/dev/null || echo MISSING')
if 'MISSING' not in node_ver:
    print(f'Node.js already installed: {node_ver}')
else:
    # Download Node.js binary locally
    if not os.path.exists(LOCAL_TMP):
        print(f'Downloading Node.js {NODE_VER} locally (~34MB)...')
        def progress(count, block, total):
            pct = min(count * block * 100 // total, 100)
            if count % 50 == 0:
                print(f'    {pct}%', end='\r', flush=True)
        urllib.request.urlretrieve(NODE_URL, LOCAL_TMP, progress)
        print(f'\n    Downloaded to {LOCAL_TMP}')
    else:
        print(f'Node.js archive already cached at {LOCAL_TMP}')

    # Upload to server
    print('Uploading Node.js to server...')
    sftp = ssh.open_sftp()
    def upload_progress(sent, total):
        pct = sent * 100 // total
        if sent % (1024*1024*2) < 65536:
            print(f'    {pct}% ({sent//1024//1024}MB / {total//1024//1024}MB)', end='\r', flush=True)
    sftp.put(LOCAL_TMP, f'/tmp/{NODE_TAR}', callback=upload_progress)
    sftp.close()
    print('\n    Upload complete')

    # Extract and install
    print('Extracting and installing Node.js...')
    run(ssh, f'cd /tmp && tar -xJf {NODE_TAR}', timeout=120)
    run(ssh, f'cp -r /tmp/node-{NODE_VER}-linux-x64/bin/* /usr/local/bin/', timeout=30)
    run(ssh, f'cp -r /tmp/node-{NODE_VER}-linux-x64/lib/* /usr/local/lib/', timeout=30)
    run(ssh, f'rm -rf /tmp/node-{NODE_VER}-linux-x64 /tmp/{NODE_TAR}', timeout=30)
    node_final = run(ssh, 'node --version && npm --version')
    print(f'Node.js installed: {node_final}')

# Install npm dependencies
print('\nInstalling npm dependencies...')
result = run(ssh, f'cd {REMOTE_DIR} && npm install --production 2>&1', timeout=180)
print('Dependencies installed')

# Install PM2
print('\nInstalling PM2...')
pm2_check = run(ssh, 'pm2 --version 2>/dev/null || echo MISSING')
if 'MISSING' in pm2_check:
    run(ssh, 'npm install -g pm2 2>&1 | tail -3', timeout=60)
print('PM2 ready')

# Stop old instance if any
run(ssh, 'pm2 stop intellimail 2>/dev/null; pm2 delete intellimail 2>/dev/null; true')

# Start app
print('\nStarting IntelliMail...')
run(ssh, f'cd {REMOTE_DIR} && pm2 start src/server.js --name intellimail', timeout=30)
run(ssh, 'pm2 save', timeout=15)

# Setup autostart
startup = run(ssh, 'pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo env PATH" || echo SKIP')
if 'SKIP' not in startup and startup.strip():
    run(ssh, startup.strip(), timeout=15)

print('\nPM2 Status:')
run(ssh, 'pm2 list')

print(f'\nDone! IntelliMail running at http://{HOST}:3099')
ssh.close()
