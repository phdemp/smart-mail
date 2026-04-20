import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=25):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

def classify(label, subject, preview, from_addr, from_name=''):
    payload = json.dumps({
        "subject": subject,
        "preview": preview,
        "from_address": from_addr,
        "from_name": from_name
    })
    payload = payload.replace("'", "'\\''")
    r = run(f"curl -s --max-time 20 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload}'")
    try:
        c = json.loads(r)
        stage = c['stage']
        print(f"  [{label:12}] stage={stage:30} category={c['category']} conf={c['confidence']:.0%}")
    except:
        print(f"  [{label:12}] FAILED: {r[:80]}")

print('=== TF-IDF Verification Tests ===')
print()
print('-- Should hit TF-IDF (high confidence categories) --')
classify('rewards',
    'Congratulations! You have earned 5000 loyalty reward points this month',
    'Dear valued customer, congratulations! You have been awarded 5000 reward points for your loyalty. Redeem your bonus points before expiry. Achievement unlocked.',
    'rewards@loyaltyprogram.com', 'Rewards Team')

classify('meeting (full)',
    'Meeting Invitation: Q1 Business Review - Please confirm attendance',
    'You are invited to the Q1 Business Review meeting on Friday March 10 at 3:00 PM in Conference Room B. Please confirm your attendance by Thursday. Agenda: quarterly targets, team updates, planning for Q2.',
    'calendar@corp.com', 'Meeting Organizer')

classify('legal (full)',
    'Legal Notice: Contract Renewal Required - Agreement Expiry March 31',
    'This is to inform you that your service agreement with Data Infosys Limited is due for renewal on March 31 2026. Please review the attached contract terms and conditions and sign before the expiry date to avoid service interruption.',
    'contracts@legalteam.com', 'Legal Department')

print()
print('-- Should hit rule_engine (keyword match) --')
classify('financial',   'Invoice INV-2026-099 Amount Due Rs 75000', 'Payment due by March 20. GST included.', 'vendor@company.com')
classify('travel',      'PNR BK9876 Indigo booking confirmed BOM-DEL', 'Your flight is booked.', 'noreply@goindigo.in')

print()
print('=== /health final stage counts ===')
r = run('curl -s --max-time 5 http://localhost:8765/health')
try:
    h = json.loads(r)
    s = h['stats']
    print(f"  stage_counts:   {s['stage_counts']}")
    print(f"  avg_latency_ms: {s['avg_latency_ms']}ms")
    print(f"  total_requests: {s['requests_total']}")
except:
    print(r[:200])

ssh.close()
