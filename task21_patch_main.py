import paramiko, sys, io, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)
sftp = ssh.open_sftp()

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Download main.py
remote_path = '/opt/intellimail-classifier/api/main.py'
with sftp.open(remote_path, 'r') as f:
    content = f.read().decode('utf-8')

print(f'Downloaded {len(content)} chars')

# ── Patch 1: add SYS_PROMPT constant after TFIDF_THRESHOLD line ───────────────
SYS_PROMPT_BLOCK = '''
SYS_PROMPT = (
    "You are an email classifier. Output ONLY valid JSON with these exact keys: "
    "category (one of: meeting_request, financial, legal, travel, pitch_deck, fyi, rewards_awards, other), "
    "confidence (0.0-1.0), urgency (normal/moderate/urgent), urgency_reason (string or null), summary (max 15 words). "
    "No explanation, no markdown, just JSON."
)
'''

if 'SYS_PROMPT' in content:
    print('SYS_PROMPT already present — skipping patch 1')
else:
    content = content.replace(
        'TFIDF_THRESHOLD = 0.75\n',
        'TFIDF_THRESHOLD = 0.75\n' + SYS_PROMPT_BLOCK
    )
    print('Patch 1 applied: SYS_PROMPT added')

# ── Patch 2: add system message and increase num_predict 60→100 ───────────────
OLD_MESSAGES = '"messages": [{"role":"user","content":prompt}],'
NEW_MESSAGES = '"messages": [{"role":"system","content":SYS_PROMPT},{"role":"user","content":prompt}],'

OLD_PREDICT = '"num_predict":60,"num_ctx":512'
NEW_PREDICT = '"num_predict":100,"num_ctx":512'

if OLD_MESSAGES in content:
    content = content.replace(OLD_MESSAGES, NEW_MESSAGES)
    print('Patch 2a applied: system message added')
else:
    print('WARNING: could not find messages line to patch')

if OLD_PREDICT in content:
    content = content.replace(OLD_PREDICT, NEW_PREDICT)
    print('Patch 2b applied: num_predict 60→100')
else:
    print('WARNING: could not find num_predict line')

# Upload patched file
with sftp.open(remote_path, 'w') as f:
    f.write(content.encode('utf-8'))
print('Uploaded patched main.py')

# Fix permissions
run(f'chown intellimail:intellimail {remote_path}')
run(f'chmod 755 {remote_path}')

# Restart
print()
print('Restarting service...')
run('systemctl restart intellimail-classifier')
time.sleep(5)
print(run('systemctl is-active intellimail-classifier'))

# Health check
health = run('curl -s --max-time 5 http://localhost:8765/health')
print(f'Health: {health[:100]}')

sftp.close()
ssh.close()
print('Done.')
