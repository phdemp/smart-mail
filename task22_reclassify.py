import paramiko, sys, json, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

APP = '/home/AjayData/xgen-intel/intellimail'
DB  = f'{APP}/intellimail.db'

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Count emails in DB
print('=== Email counts in DB ===')
total = run(f'node -e "const {{db}}=require(\'./src/db\'); console.log(db.prepare(\'SELECT COUNT(*) as n FROM emails\').get().n);" 2>&1', timeout=10)
classified = run(f'node -e "const {{db}}=require(\'./src/db\'); console.log(db.prepare(\'SELECT COUNT(*) as n FROM classifications\').get().n);" 2>&1', timeout=10)
print(f'  Total emails: {total}')
print(f'  Classified:   {classified}')

# Category distribution before
print()
print('=== Category distribution (before) ===')
cats = run(f'node -e "const {{db}}=require(\'./src/db\'); const rows=db.prepare(\'SELECT category, COUNT(*) as n FROM classifications GROUP BY category ORDER BY n DESC\').all(); rows.forEach(r=>console.log(r.category+\': \'+r.n));" 2>&1', timeout=10)
print(cats or '(no classifications yet)')

print()
print('=== PM2 restart to trigger classifyAllUnclassified ===')
print(run('cd /home/AjayData/xgen-intel/intellimail && pm2 restart intellimail 2>&1', timeout=15))

print()
print('Waiting 10s for initial classification burst...')
time.sleep(10)

print()
print('=== PM2 status ===')
print(run('pm2 list 2>/dev/null | grep intellimail'))

print()
print('=== Recent logs (classification activity) ===')
print(run('pm2 logs intellimail --lines 15 --nostream 2>/dev/null'))

ssh.close()
