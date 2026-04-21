import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

sftp = ssh.open_sftp()

# Sample "other" emails
script1 = """const {db} = require('./src/db');
const rows = db.prepare('SELECT e.subject, e.from_address FROM emails e JOIN classifications c ON c.email_id = e.id WHERE c.category = ? ORDER BY e.received_at DESC LIMIT 20').all('other');
rows.forEach(r => console.log(r.from_address.split('@')[1] + ' | ' + r.subject.substring(0,80)));"""
with sftp.open(f'{APP}/sample_other.js', 'w') as f:
    f.write(script1.encode('utf-8'))

# Sample non-other emails
script2 = """const {db} = require('./src/db');
const rows = db.prepare('SELECT e.subject, c.category FROM emails e JOIN classifications c ON c.email_id = e.id WHERE c.category != ? ORDER BY e.received_at DESC LIMIT 20').all('other');
rows.forEach(r => console.log('[' + r.category + '] ' + r.subject.substring(0,70)));"""
with sftp.open(f'{APP}/sample_nonother.js', 'w') as f:
    f.write(script2.encode('utf-8'))

sftp.close()

print('=== Sample "other" emails ===')
print(run(f'cd {APP} && node sample_other.js 2>&1', timeout=15))

print()
print('=== Sample non-other emails ===')
print(run(f'cd {APP} && node sample_nonother.js 2>&1', timeout=15))

ssh.close()
