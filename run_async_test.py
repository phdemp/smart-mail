import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Upload test script
sftp = ssh.open_sftp()
sftp.put(r'I:\xgen-intel\intellimail\test_async_local.js', f'{APP}/test_async_local.js')
sftp.close()
print('Script uploaded.')

# Run it
print('Running async classification test...')
print()
result = run(f'cd {APP} && node test_async_local.js 2>&1', timeout=25)
print(result)

ssh.close()
