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

# Check current num_predict in main.py
print('=== num_predict / num_ctx in main.py ===')
print(run('grep -n "num_predict\|num_ctx\|num_tokens\|max_tokens" /opt/intellimail-classifier/api/main.py'))

# Test raw Ollama with small num_predict to see what gets cut
print()
print('=== Raw Ollama test with num_predict=60 ===')
test_payload = json.dumps({
    "model": "intellimail-qwen",
    "prompt": 'Classify this email as JSON. Output ONLY valid JSON with keys: category (one of: meeting_request,financial,legal,travel,pitch_deck,fyi,rewards_awards,other), confidence, urgency (normal/moderate/urgent), summary.\n\nSubject: Team sync meeting tomorrow 3pm\nBody: Please join the Q1 review meeting at 3pm in room 4B.\n\nJSON:',
    "stream": False,
    "options": {"num_predict": 60, "temperature": 0.1}
})
r = run(f"curl -s --max-time 15 -X POST http://10.11.13.179:11434/api/generate -H 'Content-Type: application/json' -d '{test_payload}'", timeout=20)
try:
    resp = json.loads(r)
    print(f"  response: {resp.get('response','')!r}")
    print(f"  done_reason: {resp.get('done_reason','')}")
    print(f"  eval_count: {resp.get('eval_count','?')} tokens")
except:
    print(r[:300])

# Check what error handling returns on bad JSON
print()
print('=== Error handling: what does classifier return on JSON parse fail? ===')
print(run('grep -A 10 "bad_json\|json_parse\|JSONDecodeError\|Bad JSON\|fallback\|other.*default" /opt/intellimail-classifier/api/main.py | head -30'))

ssh.close()
