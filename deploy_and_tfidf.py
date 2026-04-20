import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

STAGING = '10.11.13.237'
GPU     = '10.11.13.179'
PASS    = 'Digl!@#$Data321'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(STAGING, username='root', password=PASS, timeout=30)

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

sftp = ssh.open_sftp()

# ── 1. Deploy updated Node.js files to staging ───────────────────────────────
print('=== 1. Deploying updated Node.js files ===')
sftp.put(r'I:\xgen-intel\intellimail\src\classifier.js',
         '/home/AjayData/xgen-intel/intellimail/src/classifier.js')
sftp.put(r'I:\xgen-intel\intellimail\src\routes\api.js',
         '/home/AjayData/xgen-intel/intellimail/src/routes/api.js')
print('  classifier.js uploaded')
print('  api.js uploaded')

# Verify the change
print(run("grep 'LOCAL_API' /home/AjayData/xgen-intel/intellimail/src/classifier.js | head -1"))

# ── 2. Restart PM2 ───────────────────────────────────────────────────────────
print()
print('=== 2. Restarting PM2 intellimail ===')
print(run('pm2 restart intellimail && echo "PM2 restarted OK"'))
time.sleep(3)
print(run('pm2 list | grep intellimail'))

# ── 3. Deploy TF-IDF to GPU FastAPI ─────────────────────────────────────────
print()
print('=== 3. Deploying TF-IDF to GPU FastAPI ===')

# 3a. Install sklearn on GPU via Ollama machine's venv
print('  Installing sklearn on GPU FastAPI venv...')
result = run(
    f'curl -s --max-time 5 http://{GPU}:8765/health | python3 -c "import sys,json; h=json.load(sys.stdin); print(h[\'stats\'][\'stage_counts\'])"',
    timeout=10
)
print(f'  Current GPU stages: {result}')

# Check if GPU FastAPI venv has sklearn
# We'll copy the model file via staging, then update main.py via the Ollama API won't work
# Instead, use staging as relay to push files to GPU via SSH from staging
print()
print('  Checking SSH from staging to GPU...')
ssh_check = run(f'ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes root@{GPU} "echo SSH_OK" 2>&1')
print(f'  SSH result: {ssh_check}')

if 'SSH_OK' in ssh_check:
    print('  SSH works! Installing sklearn and copying TF-IDF model...')
    # Install sklearn
    print(run(f'ssh -o StrictHostKeyChecking=no root@{GPU} "/opt/intellimail-classifier/venv/bin/pip install scikit-learn joblib numpy -q && echo sklearn_installed"', timeout=120))
    # Copy model file
    print(run(f'scp /opt/intellimail-classifier/data/tfidf_model.joblib root@{GPU}:/opt/intellimail-classifier/data/tfidf_model.joblib 2>&1'))
    # Copy updated main.py
    print(run(f'scp /opt/intellimail-classifier/api/main.py root@{GPU}:/opt/intellimail-classifier/api/main.py 2>&1'))
    # Restart GPU FastAPI
    print(run(f'ssh -o StrictHostKeyChecking=no root@{GPU} "systemctl restart intellimail-classifier && echo restarted"', timeout=15))
else:
    print('  SSH from staging to GPU not available.')
    print('  GPU FastAPI TF-IDF will need manual setup.')
    print('  For now, GPU FastAPI uses rule_engine + LLM (still fast with GPU).')

sftp.close()

# ── 4. Final verification ─────────────────────────────────────────────────────
print()
print('=== 4. Final verification ===')
time.sleep(4)

# Test Node.js is now hitting GPU
print('PM2 logs (last 5):')
print(run('pm2 logs intellimail --lines 5 --nostream 2>/dev/null'))

# Test GPU FastAPI directly
print()
print('GPU FastAPI classify test:')
result = run(
    f'curl -s --max-time 15 -X POST http://{GPU}:8765/classify '
    f'-H "Content-Type: application/json" '
    f'-d \'{{"subject":"IndiGo Booking Confirmed PNR XY123","from_address":"noreply@goindigo.in","preview":"Your flight DEL-BOM March 20 confirmed.","email_id":"deploy_test"}}\' ',
    timeout=20
)
print(result)

ssh.close()
print()
print('Done.')
