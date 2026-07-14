#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

PORT=8000

stop_port_processes() {
  local pids
  pids=$(lsof -t -i :"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "⚠️  Порт $PORT занят. Останавливаю старый процесс..."
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

stop_port_processes

echo "▶ Запускаю сервер на http://127.0.0.1:$PORT"
echo

trap 'echo; echo "→ Сервер остановлен."; exit 0' INT TERM

.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --reload
