import paramiko, sys, json, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
sftp = ssh.open_sftp()

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=20):
    _, o, e = ssh.exec_command(cmd, timeout=timeout)
    return (o.read()+e.read()).decode('utf-8','replace').strip()

# Delete all "other" classifications so classifyAllUnclassified reclassifies them
script = """const {db} = require('./src/db');
const deleted = db.prepare("DELETE FROM classifications WHERE category = 'other'").run();
console.log('deleted: ' + deleted.changes);
const remaining = db.prepare("SELECT COUNT(*) as n FROM classifications").get().n;
const total = db.prepare("SELECT COUNT(*) as n FROM emails").get().n;
console.log('classified: ' + remaining + ' / ' + total);
"""
with sftp.open(f'{APP}/delete_others.js', 'w') as f:
    f.write(script.encode('utf-8'))
sftp.close()

print('=== Deleting "other" classifications for reclassification ===')
print(run(f'cd {APP} && node delete_others.js 2>&1', timeout=10))

# PM2 restart to trigger classifyAllUnclassified
print()
print('=== Restarting PM2 to trigger reclassification ===')
run(f'cd {APP} && pm2 restart intellimail 2>&1')

# Poll for completion
print('Waiting for reclassification (checking every 15s)...')
for i in range(12):  # up to 3 min
    time.sleep(15)
    script2 = """const {db}=require('./src/db');
const t=db.prepare('SELECT COUNT(*) as n FROM emails').get().n;
const c=db.prepare('SELECT COUNT(*) as n FROM classifications').get().n;
console.log(c+'/'+t);"""
    sftp2 = ssh.open_sftp()
    with sftp2.open(f'{APP}/count2.js', 'w') as f:
        f.write(script2.encode('utf-8'))
    sftp2.close()
    result = run(f'cd {APP} && node count2.js 2>&1', timeout=10)
    classified, total = result.split('/')
    pct = int(classified) / int(total) * 100
    print(f'  [{i*15+15}s] {result} ({pct:.0f}%)')
    if int(classified) >= int(total):
        break

# Final distribution
print()
print('=== Final category distribution ===')
sftp3 = ssh.open_sftp()
script3 = """const {db}=require('./src/db');
db.prepare('SELECT category, COUNT(*) as n FROM classifications GROUP BY category ORDER BY n DESC').all().forEach(r=>console.log(r.category+': '+r.n));"""
with sftp3.open(f'{APP}/cats.js', 'w') as f:
    f.write(script3.encode('utf-8'))
sftp3.close()
print(run(f'cd {APP} && node cats.js 2>&1', timeout=10))

ssh.close()
