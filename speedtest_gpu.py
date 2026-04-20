import paramiko, sys, time, json
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

print('=== Verify num_predict on GPU ===')
print(run(f'curl -s http://{GPU}:8765/health | python3 -c "import sys,json; h=json.load(sys.stdin); print(h)"'))

print()
print('=== Speed tests (LLM path — 5 emails) ===')
tests = [
    ('Catch up call this week?',           'someone@company.com',   'Hey can we find time to chat?'),
    ('Following up on our last discussion','partner@company.com',    'Just wanted to check in on where things stand.'),
    ('Thoughts on the Q2 roadmap?',        'colleague@work.com',    'Would love your input on priorities for next quarter.'),
    ('Introduction - connecting you both', 'mutual@friend.com',     'Thought you two should know each other.'),
    ('Re: your application',               'hr@bigcorp.com',        'Thank you for applying. We will be in touch.'),
]

times = []
for i, (subj, frm, preview) in enumerate(tests, 1):
    payload = json.dumps({"subject": subj, "from_address": frm, "preview": preview, "email_id": f"t{i}"})
    t0 = time.time()
    result = run(
        f'curl -s --max-time 30 -X POST http://{GPU}:8765/classify '
        f'-H "Content-Type: application/json" '
        f"-d '{payload}'",
        timeout=35
    )
    elapsed = int((time.time() - t0) * 1000)
    try:
        d = json.loads(result)
        ms = d.get('processing_ms', elapsed)
        stage = d.get('stage', '?')
        cat = d.get('category', '?')
        times.append(ms)
        print(f'  [{i}] {subj[:40]:<40} => {cat:<18} {stage:<25} {ms}ms')
    except:
        print(f'  [{i}] Error: {result[:80]}')

if times:
    print(f'\n  Average: {sum(times)//len(times)}ms | Min: {min(times)}ms | Max: {max(times)}ms')
    print(f'  vs CPU baseline: ~70,000ms | Speedup: {70000//max(times, 1)}x')

ssh.close()
