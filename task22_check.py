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

# Check email counts via sqlite3 approach using node from app dir
print('=== Email / classification counts ===')
script = """
const {db} = require('./src/db');
const total = db.prepare('SELECT COUNT(*) as n FROM emails').get().n;
const classed = db.prepare('SELECT COUNT(*) as n FROM classifications').get().n;
console.log('total_emails:', total);
console.log('classified:', classed);
console.log('unclassified:', total - classed);
"""
print(run(f"cd {APP} && node -e \"{script.strip().replace(chr(10), ' ').replace('\"', chr(39))}\" 2>&1", timeout=15))

print()
print('=== Category distribution ===')
cat_script = """
const {db} = require('./src/db');
const rows = db.prepare('SELECT category, COUNT(*) as n FROM classifications GROUP BY category ORDER BY n DESC').all();
rows.forEach(r => console.log(r.category + ': ' + r.n));
"""
print(run(f"cd {APP} && node -e \"{cat_script.strip().replace(chr(10), ' ').replace('\"', chr(39))}\" 2>&1", timeout=15))

print()
print('=== PM2 logs (out, last 20) ===')
print(run('pm2 logs intellimail --lines 20 --nostream 2>/dev/null | grep -v "TAILING\|pm2\|Circuit\|Authentication\|Connection not\|authFailed\|_connId"'))

ssh.close()
