import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
sftp = ssh.open_sftp()

APP = '/home/AjayData/xgen-intel/intellimail'

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Upload updated files
print('Uploading classifier.js...')
sftp.put(r'I:\xgen-intel\intellimail\src\classifier.js', f'{APP}/src/classifier.js')

print('Uploading api.js...')
sftp.put(r'I:\xgen-intel\intellimail\src\routes\api.js', f'{APP}/src/routes/api.js')

sftp.close()
print('Upload done.')

# Verify
print()
print('=== Verify LOCAL_API in classifier.js ===')
print(run(f'grep LOCAL_API {APP}/src/classifier.js'))
print(run(f'grep LOCAL_API {APP}/src/routes/api.js'))

# Restart PM2
print()
print('=== PM2 restart ===')
print(run(f'cd {APP} && pm2 restart intellimail 2>&1'))

time.sleep(5)

# Quick verify — test a classification
print()
print('=== Verify: classify test email via Node.js ===')
script = """
const {queueClassification} = require('./src/classifier');
const {db} = require('./src/db');

// Find most recent unclassified email or any email
const e = db.prepare('SELECT id, subject FROM emails ORDER BY id DESC LIMIT 1').get();
console.log('Testing with email id:', e.id, '|', e.subject.substring(0,60));

// Check /health via classifier LOCAL_API
const http = require('http');
http.get('http://localhost:8765/health', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const h = JSON.parse(d);
      console.log('FastAPI health: status=' + h.status + ' ollama_connected=' + h.ollama.connected);
      console.log('stage_counts:', JSON.stringify(h.stats.stage_counts));
    } catch(err) {
      console.log('health raw:', d.substring(0,100));
    }
    process.exit(0);
  });
}).on('error', err => { console.log('health error:', err.message); process.exit(1); });
"""
with ssh.open_sftp() as s2:
    with s2.open(f'{APP}/verify_deploy.js', 'w') as f:
        f.write(script.encode('utf-8'))

print(run(f'cd {APP} && node verify_deploy.js 2>&1', timeout=15))

print()
print('=== PM2 status ===')
print(run('pm2 list 2>/dev/null | grep intellimail'))

ssh.close()
print('Done.')
