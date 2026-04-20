"""
IntelliMail deployment script — uploads app to staging server via SSH/SFTP
"""
import paramiko, os, sys, stat
from pathlib import Path

HOST = 'SERVER_IP_REDACTED'
USER = 'SERVER_USER_REDACTED'
PASS = 'SERVER_PASSWORD_REDACTED'
REMOTE_DIR = '/home/AjayData/xgen-intel/intellimail'
LOCAL_DIR = Path(r'I:\xgen-intel\intellimail')
API_KEY = 'ANTHROPIC_API_KEY_REDACTED'
PORT = 3099

# Files/dirs to skip
SKIP = {
    'node_modules', 'intellimail.db', '.env', 'server.log',
    'nohup.out', 'deploy.py', '.git', '__pycache__', '*.pyc'
}

def should_skip(name):
    return name in SKIP or name.endswith('.pyc') or name.endswith('.db')

def run(ssh, cmd, check=True):
    print(f'  $ {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(f'    {out}')
    if err and 'warn' not in err.lower(): print(f'    ERR: {err}')
    return out

def upload_dir(sftp, local_path, remote_path):
    """Recursively upload a directory."""
    try:
        sftp.mkdir(remote_path)
    except IOError:
        pass  # already exists

    for item in local_path.iterdir():
        if should_skip(item.name):
            continue
        r = f"{remote_path}/{item.name}"
        if item.is_dir():
            upload_dir(sftp, item, r)
        else:
            print(f'  uploading {item.relative_to(LOCAL_DIR)}')
            sftp.put(str(item), r)

def main():
    print(f'\nDeploying IntelliMail to {HOST}:{REMOTE_DIR}\n')

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)
    print('✓ SSH connected')

    # Create remote directory
    run(ssh, f'mkdir -p {REMOTE_DIR}')
    print('✓ Remote directory ready')

    # Upload files via SFTP
    sftp = ssh.open_sftp()
    print('\n📦 Uploading files...')
    upload_dir(sftp, LOCAL_DIR, REMOTE_DIR)
    sftp.close()
    print('✓ Files uploaded')

    # Write .env on server
    env_content = f'PORT={PORT}\\nANTHROPIC_API_KEY={API_KEY}\\n'
    run(ssh, f"printf 'PORT={PORT}\\nANTHROPIC_API_KEY={API_KEY}\\n' > {REMOTE_DIR}/.env")
    print('✓ .env created')

    # Install Node.js if missing
    print('\n🔧 Checking Node.js...')
    node_ver = run(ssh, 'node --version 2>/dev/null || echo "missing"')
    if 'missing' in node_ver or not node_ver.startswith('v'):
        print('  Installing Node.js 22...')
        run(ssh, 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -')
        run(ssh, 'apt-get install -y nodejs')
    else:
        print(f'  Node.js {node_ver} already installed')

    # Install dependencies
    print('\n📦 Installing npm dependencies...')
    run(ssh, f'cd {REMOTE_DIR} && npm install --production 2>&1 | tail -5')
    print('✓ Dependencies installed')

    # Install PM2 if missing
    print('\n🔧 Checking PM2...')
    pm2_ver = run(ssh, 'pm2 --version 2>/dev/null || echo "missing"')
    if 'missing' in pm2_ver:
        run(ssh, 'npm install -g pm2')
        print('  PM2 installed')
    else:
        print(f'  PM2 {pm2_ver} already installed')

    # Stop existing app if running
    run(ssh, f'pm2 stop intellimail 2>/dev/null || true')
    run(ssh, f'pm2 delete intellimail 2>/dev/null || true')

    # Start with PM2
    print('\n🚀 Starting application with PM2...')
    run(ssh, f'cd {REMOTE_DIR} && pm2 start src/server.js --name intellimail --env production')
    run(ssh, 'pm2 save')
    run(ssh, 'pm2 startup 2>/dev/null | tail -3')

    # Show status
    print('\n📊 PM2 Status:')
    run(ssh, 'pm2 list')

    print(f'\n✅ Deployment complete!')
    print(f'   App running at http://{HOST}:{PORT}')
    ssh.close()

if __name__ == '__main__':
    main()
