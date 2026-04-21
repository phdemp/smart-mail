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

# Sample 20 "other" emails and show their subjects
print('=== Sample of "other" classified emails (subjects) ===')
script = """
const {db} = require('./src/db');
const rows = db.prepare(
  'SELECT e.subject, e.from_address FROM emails e JOIN classifications c ON c.email_id = e.id WHERE c.category = ? ORDER BY e.received_at DESC LIMIT 20'
).all('other');
rows.forEach(r => console.log(r.from_address.split('@')[1] + ' | ' + r.subject.substring(0,80)));
"""
# Write script to file and run it
sftp = ssh.open_sftp()
with sftp.open(f'{APP}/sample_other.js', 'w') as f:
    f.write(script.encode('utf-8'))
sftp.close()

print(run(f'cd {APP} && node sample_other.js 2>&1', timeout=15))

print()
print('=== Sample of non-other emails (should be correctly classified) ===')
script2 = """
const {db} = require('./src/db');
const rows = db.prepare(
  'SELECT e.subject, c.category FROM emails e JOIN classifications c ON c.email_id = e.id WHERE c.category != ? ORDER BY e.received_at DESC LIMIT 20'
).all('other');
rows.forEach(r => console.log('[' + r.category + '] ' + r.subject.substring(0,70)));
"""
with sftp_open := ssh.open_sftp():
    with sftp_open.open(f'{APP}/sample_nonother.js', 'w') as f:
        f.write(script2.encode('utf-8'))

print(run(f'cd {APP} && node sample_nonother.js 2>&1', timeout=15))

ssh.close()
