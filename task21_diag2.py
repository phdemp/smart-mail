import paramiko, sys, json
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

def run(cmd, timeout=15):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    return o or e

# Check Ollama URL config in main.py
print('=== Ollama URL in main.py ===')
print(run('grep -n "ollama\|OLLAMA\|11434\|10.11.13" /opt/intellimail-classifier/api/main.py | head -20'))

# Check if Ollama is responding on staging itself
print()
print('=== Ollama localhost:11434 ===')
print(run('curl -s --max-time 3 http://localhost:11434/api/tags 2>&1 | head -100'))

# Check if GPU Ollama is reachable from staging
print()
print('=== GPU Ollama 10.11.13.179:11434 ===')
print(run('curl -s --max-time 5 http://10.11.13.179:11434/api/tags 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print([m[\"name\"] for m in d.get(\"models\",[])])" 2>&1'))

# Check TF-IDF failure - does predict_proba work
print()
print('=== TF-IDF quick python test ===')
print(run('cd /opt/intellimail-classifier && source venv/bin/activate && python3 -c "import joblib; m=joblib.load(\'data/tfidf_model.joblib\'); r=m.predict_proba([\'team sync meeting tomorrow agenda\']); print(list(zip(m.classes_, r[0].round(3))))"'))

# Check what confidence threshold tfidf uses vs outputs
print()
print('=== tfidf_classify function details ===')
print(run('sed -n "212,250p" /opt/intellimail-classifier/api/main.py'))

ssh.close()
