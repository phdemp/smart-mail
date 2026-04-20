import paramiko, sys, json, time
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

def classify(subject, body, from_addr, label):
    payload = json.dumps({"subject": subject, "preview": body, "from_address": from_addr})
    # escape for shell
    payload_escaped = payload.replace("'", "'\\''")
    r = run(f"curl -s --max-time 20 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload_escaped}'", timeout=25)
    try:
        c = json.loads(r)
        print(f"  [{label}] category={c['category']} stage={c['stage']} latency={c.get('latency_ms','?')}ms")
    except:
        print(f"  [{label}] FAILED or timeout: {r[:100] if r else 'empty'}")

print('=== Live classification tests (GPU Ollama) ===')
classify("Invoice INV-2026-091 Amount Due Rs 55000", "Please pay the invoice by March 15.", "vendor@company.com", "financial")
classify("Your PNR AI98765 booking confirmed Indigo", "Flight from BOM to DEL on March 10.", "noreply@goindigo.in", "travel")
classify("Team meeting agenda for Q1 review", "Please join us for the Q1 review meeting on Friday at 3pm.", "manager@corp.com", "meeting")
classify("Startup pitch deck for Series A", "We are raising Series A. Please review our pitch deck.", "founder@startup.io", "pitch_deck")
classify("Company newsletter March 2026", "This month: quarterly review, new hires, events.", "hr@corp.com", "fyi")

print()
print('=== /health stage counts ===')
r = run('curl -s --max-time 5 http://localhost:8765/health')
try:
    h = json.loads(r)
    s = h['stats']
    print(f"  stage_counts: {s['stage_counts']}")
    print(f"  avg_latency_ms: {s['avg_latency_ms']}")
    print(f"  total_requests: {s['requests_total']}")
except:
    print(r)

print()
print('=== Recent errors in log ===')
print(run("tail -5 /var/log/intellimail/api.log | grep -i error 2>/dev/null || echo 'no errors'"))

ssh.close()
