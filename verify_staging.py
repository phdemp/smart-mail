import paramiko

HOST = "10.11.13.237"
USER = "root"
PASSWORD = "Digl!@#$Data321"

def run(ssh, cmd, label=""):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if label:
        print(f"\n--- {label} ---")
    print(out if out else "(no output)")
    if err:
        print("STDERR:", err)
    return out

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

APP = "/home/AjayData/xgen-intel/intellimail"

print("=== Step 2: Grep verification ===")
run(ssh, f'grep -n "setBroadcast\\|classification_done\\|setClassifierBroadcast" {APP}/src/classifier.js | head -5',
    "classifier.js — setBroadcast/classification_done/setClassifierBroadcast")

run(ssh, f'grep -n "setClassifierBroadcast" {APP}/src/server.js',
    "server.js — setClassifierBroadcast")

run(ssh, f'grep -n "pending\\|Classifying" {APP}/src/routes/api.js | head -5',
    "api.js — pending/Classifying")

run(ssh, f'grep -n "classification_done" {APP}/public/js/app.js',
    "app.js — classification_done")

run(ssh, f'grep -n "badge-pending\\|pulse-pending" {APP}/public/css/app.css | head -3',
    "app.css — badge-pending/pulse-pending")

print("\n=== Step 3: Find unclassified email ID ===")
out = run(ssh,
    f'sqlite3 {APP}/intellimail.db "SELECT e.id FROM emails e LEFT JOIN classifications c ON c.email_id=e.id WHERE c.id IS NULL LIMIT 1"',
    "Unclassified email ID")
if out.strip():
    print(f"Unclassified email found — id: {out.strip()}")
else:
    print("No unclassified emails found (all emails already classified).")

print("\n=== Step 4: PM2 logs (last 20 lines) ===")
run(ssh, "pm2 logs intellimail --lines 20 --nostream 2>/dev/null",
    "PM2 logs")

ssh.close()
print("\n=== Verification complete ===")
