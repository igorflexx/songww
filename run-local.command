#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

PORT=8000

if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  Порт $PORT занят. Гашу старый процесс..."
  ./kill-local.command >/dev/null 2>&1 || true
  sleep 1
fi

echo "▶ Запускаю сервер на http://127.0.0.1:$PORT"
echo

trap 'echo; echo "→ Сервер остановлен."; exit 0' INT TERM

.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --reload
