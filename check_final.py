import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
sftp = ssh.open_sftp()

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=15):
    _, o, e = ssh.exec_command(cmd, timeout=timeout)
    return (o.read()+e.read()).decode('utf-8','replace').strip()

print('Waiting 90s for more reclassification...')
time.sleep(90)

script = """const {db} = require('./src/db');
const t = db.prepare('SELECT COUNT(*) as n FROM emails').get().n;
const c = db.prepare('SELECT COUNT(*) as n FROM classifications').get().n;
console.log('classified: ' + c + ' / ' + t + ' (' + Math.round(c/t*100) + '%)');
console.log('');
db.prepare('SELECT category, COUNT(*) as n FROM classifications GROUP BY category ORDER BY n DESC').all()
  .forEach(r => console.log(r.category + ': ' + r.n));
"""
with sftp.open(f'{APP}/final_check.js', 'w') as f:
    f.write(script.encode('utf-8'))
sftp.close()

print(run(f'cd {APP} && node final_check.js 2>&1', timeout=15))
ssh.close()
