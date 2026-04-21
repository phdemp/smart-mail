import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=20):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Task 21: Check TF-IDF health / stage counts
print('=== FastAPI /health (staging) ===')
r = run('curl -s --max-time 5 http://localhost:8765/health')
try:
    h = json.loads(r)
    s = h['stats']
    print(f"  status: {h['status']} | model: {h['model']}")
    print(f"  stage_counts: {s['stage_counts']}")
    print(f"  avg_latency_ms: {s['avg_latency_ms']} | total_requests: {s['requests_total']}")
except:
    print(r)

# Quick classification tests
print()
print('=== Test 1: financial email (should hit rule_engine) ===')
payload1 = '{"subject":"Invoice INV-2026-090 Amount Due","body":"Invoice for Q3. Amount due Rs 50000.","from_address":"vendor@example.com"}'
r2 = run(f"curl -s --max-time 10 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload1}'")
try:
    c = json.loads(r2)
    print(f"  category: {c['category']} | stage: {c['stage']} | latency_ms: {c.get('latency_ms','?')}")
except:
    print(r2)

print()
print('=== Test 2: meeting email (should hit TF-IDF or LLM) ===')
payload2 = '{"subject":"Team sync tomorrow 3pm","body":"Hi, please join the team sync meeting tomorrow at 3pm in room 4B. Agenda attached.","from_address":"manager@company.com"}'
r3 = run(f"curl -s --max-time 10 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload2}'")
try:
    c = json.loads(r3)
    print(f"  category: {c['category']} | stage: {c['stage']} | latency_ms: {c.get('latency_ms','?')}")
except:
    print(r3)

print()
print('=== Test 3: travel email (should hit TF-IDF) ===')
payload3 = '{"subject":"Your flight booking confirmation PNR ABCDEF","body":"Flight booking confirmed. PNR: ABCDEF. Delhi to Mumbai. Departure 10:30 AM.","from_address":"noreply@airline.com"}'
r4 = run(f"curl -s --max-time 10 -X POST http://localhost:8765/classify -H 'Content-Type: application/json' -d '{payload3}'")
try:
    c = json.loads(r4)
    print(f"  category: {c['category']} | stage: {c['stage']} | latency_ms: {c.get('latency_ms','?')}")
except:
    print(r4)

print()
print('=== Final /health stage_counts after tests ===')
r5 = run('curl -s --max-time 5 http://localhost:8765/health')
try:
    h = json.loads(r5)
    s = h['stats']
    print(f"  stage_counts: {s['stage_counts']}")
    print(f"  total_requests: {s['requests_total']}")
except:
    print(r5)

ssh.close()
