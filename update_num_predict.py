import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

MAIN = '/opt/intellimail-classifier/api/main.py'

print('=== Before ===')
print(run(f'grep -n "num_predict" {MAIN}'))

# Change num_predict from 600 to 60
print()
print('=== Applying change ===')
print(run(f"sed -i 's/\"num_predict\":600/\"num_predict\":60/' {MAIN}"))
print(run(f"sed -i 's/\"num_predict\": 600/\"num_predict\": 60/' {MAIN}"))

print()
print('=== After ===')
print(run(f'grep -n "num_predict" {MAIN}'))

# Also check num_ctx - reduce from 2048 to 512 (email classification needs very little context)
print()
print('=== num_ctx (context window) ===')
print(run(f'grep -n "num_ctx" {MAIN}'))

# Restart staging FastAPI
print()
print('=== Restart staging FastAPI ===')
print(run('systemctl restart intellimail-classifier 2>/dev/null && echo "restarted via systemd" || echo "no systemd unit on staging"'))

ssh.close()
