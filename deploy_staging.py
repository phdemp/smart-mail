import paramiko
import time
import sys

HOST = "10.11.13.237"
USER = "root"
PASSWORD = "Digl!@#$Data321"

FILES = [
    (r"I:\xgen-intel\intellimail\src\classifier.js",       "/home/AjayData/xgen-intel/intellimail/src/classifier.js"),
    (r"I:\xgen-intel\intellimail\src\server.js",           "/home/AjayData/xgen-intel/intellimail/src/server.js"),
    (r"I:\xgen-intel\intellimail\src\routes\api.js",       "/home/AjayData/xgen-intel/intellimail/src/routes/api.js"),
    (r"I:\xgen-intel\intellimail\public\css\app.css",      "/home/AjayData/xgen-intel/intellimail/public/css/app.css"),
    (r"I:\xgen-intel\intellimail\public\js\app.js",        "/home/AjayData/xgen-intel/intellimail/public/js/app.js"),
    (r"I:\xgen-intel\intellimail\views\dashboard.html",    "/home/AjayData/xgen-intel/intellimail/views/dashboard.html"),
]

def run_cmd(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return out, err

print("=== Step 1: Connecting to staging ===")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
print(f"Connected to {HOST}")

print("\n=== Step 2: Uploading files via SFTP ===")
sftp = ssh.open_sftp()
for local, remote in FILES:
    try:
        sftp.put(local, remote)
        print(f"  UPLOADED: {local.split(chr(92))[-1]}  ->  {remote}")
    except Exception as e:
        print(f"  ERROR uploading {local}: {e}", file=sys.stderr)
        sftp.close()
        ssh.close()
        sys.exit(1)
sftp.close()
print("All 6 files uploaded successfully.")

print("\n=== Step 3: Restarting PM2 ===")
out, err = run_cmd(ssh, "pm2 restart intellimail")
print(out)
if err.strip():
    print("STDERR:", err)

print("Waiting 4 seconds for process to stabilise...")
time.sleep(4)

print("\n=== Step 4: Checking PM2 status ===")
out, err = run_cmd(ssh, "pm2 list")
print(out)
if "online" in out:
    print("PM2 status: ONLINE")
else:
    print("WARNING: 'online' not found in pm2 list output — check manually.")

ssh.close()
print("\nDone.")
