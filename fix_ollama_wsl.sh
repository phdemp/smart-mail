#!/bin/bash
# Run this in WSL terminal on the GPU machine

echo "=== Step 1: Set OLLAMA_HOST to listen on all interfaces ==="
if systemctl is-active --quiet ollama 2>/dev/null; then
    # Using systemd
    sudo mkdir -p /etc/systemd/system/ollama.service.d/
    sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null <<EOF
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
    sudo systemctl daemon-reload
    sudo systemctl restart ollama
    echo "Restarted via systemd"
else
    echo "Ollama not running via systemd."
    echo "Run manually: OLLAMA_HOST=0.0.0.0:11434 ollama serve &"
fi

echo ""
echo "=== Step 2: Check Ollama is listening ==="
sleep 2
ss -tlnp | grep 11434 || netstat -tlnp 2>/dev/null | grep 11434

echo ""
echo "=== Step 3: WSL IP (needed for Windows port proxy) ==="
hostname -I | awk '{print $1}'

echo ""
echo "=== Step 4: Test Ollama locally ==="
curl -s http://localhost:11434/api/version
