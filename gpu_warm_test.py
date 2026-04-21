import paramiko, sys, json, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

GPU = '10.11.13.179'

test_emails = [
    ('Quick question about Q2 roadmap', 'colleague@company.com', 'Wanted your thoughts on priorities.'),
    ('Follow up on our discussion', 'partner@company.com', 'Just checking in on what we talked about.'),
    ('Introducing our new AI platform', 'founder@startup.io', 'We are seeking Series A investment.'),
]

print('=== Warm GPU LLM speed tests ===')
for i, (subj, frm, preview) in enumerate(test_emails, 1):
    payload = json.dumps({"subject": subj, "from_address": frm, "preview": preview, "email_id": f"warm{i}"})
    r = run(
        f'curl -s --max-time 60 -X POST http://{GPU}:8765/classify '
        f'-H "Content-Type: application/json" '
        f"-d '{payload}'",
        timeout=65
    )
    try:
        d = json.loads(r)
        print(f'  [{i}] {subj[:40]}')
        print(f'      => {d["category"]} | stage={d["stage"]} | {d["processing_ms"]}ms')
    except:
        print(f'  [{i}] Error: {r[:100]}')

ssh.close()
