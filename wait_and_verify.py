import paramiko, sys, time, json
sys.stdout.reconfigure(encoding='utf-8')

GPU = '10.11.13.179'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=30):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

print('Polling every 30s for model to finish downloading...')
for i in range(20):
    tags = run(f'curl -s --max-time 5 http://{GPU}:11434/api/tags')
    try:
        models = json.loads(tags).get('models', [])
        names = [m['name'] for m in models]
        if names:
            print(f'\n[{i*30}s] Models available: {names}')
            break
        else:
            # Show download progress
            prog = run(
                f'curl -s --max-time 3 -X POST http://{GPU}:11434/api/pull '
                f'-H "Content-Type: application/json" '
                f'-d \'{{"name":"qwen2.5:7b","stream":true}}\' 2>&1 | tail -1',
                timeout=8
            )
            try:
                d = json.loads(prog)
                pct = d.get('completed', 0) / d.get('total', 1) * 100
                print(f'[{i*30}s] Downloading... {pct:.1f}% ({d.get("completed",0)//1024//1024}MB / {d.get("total",0)//1024//1024}MB)')
            except:
                print(f'[{i*30}s] Still downloading... ({prog[:80]})')
    except:
        print(f'[{i*30}s] Checking... ({tags[:60]})')
    time.sleep(30)

# Model should be ready now — create alias and test
print()
print('=== Creating intellimail-qwen alias ===')
result = run(
    f'curl -s -X POST http://{GPU}:11434/api/copy '
    f'-H "Content-Type: application/json" '
    f'-d \'{{"source":"qwen2.5:7b","destination":"intellimail-qwen"}}\' '
)
print(result or 'OK (empty = success)')

time.sleep(2)

print()
print('=== Final model list on GPU ===')
print(run(f'curl -s http://{GPU}:11434/api/tags'))

print()
print('=== FastAPI health ===')
print(run(f'curl -s http://{GPU}:8765/health'))

print()
print('=== Speed test — LLM call on GPU ===')
t = run(
    f'time curl -s --max-time 60 -X POST http://{GPU}:8765/classify '
    f'-H "Content-Type: application/json" '
    f'-d \'{{"subject":"Quick question about the project roadmap","from_address":"colleague@company.com","preview":"Wanted your thoughts on Q2 priorities.","email_id":"gpu_test"}}\' ',
    timeout=65
)
print(t)

ssh.close()
