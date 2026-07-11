#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

PORT=8000
MODE="${1:-public}"
SSH_PID=""
SSH_LOG=$(mktemp -t lhr_run)
URL=""

cleanup() {
  echo
  echo "→ Останавливаю..."
  [ -n "$SSH_PID" ] && kill "$SSH_PID" 2>/dev/null || true
  pkill -P $$ 2>/dev/null || true
  if [ -n "$URL" ]; then rm -f "$SSH_LOG" 2>/dev/null || true; fi
  exit 0
}
trap cleanup INT TERM EXIT

if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  Порт $PORT занят. Запускаю ./kill.command и пробую снова."
  ./kill.command >/dev/null 2>&1 || true
  sleep 1
fi

echo "▶ uvicorn → http://127.0.0.1:$PORT"
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --reload &
UV_PID=$!

until curl -fs -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; do
  if ! kill -0 "$UV_PID" 2>/dev/null; then
    echo "❌ uvicorn упал, см. вывод выше"
    exit 1
  fi
  sleep 1
done
echo "✓ сервер готов"

if [ "$MODE" = "public" ]; then
  echo "▶ Открываю публичный туннель через localhost.run..."
  ssh -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=30 \
      -o ExitOnForwardFailure=yes \
      -R 80:localhost:"$PORT" nokey@localhost.run > "$SSH_LOG" 2>&1 &
  SSH_PID=$!

  echo "  (жду публичный URL — обычно 3-5 секунд...)"
  for i in $(seq 1 30); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.lhr\.life' "$SSH_LOG" 2>/dev/null | head -1 || true)
    [ -n "$URL" ] && break
    if ! kill -0 "$SSH_PID" 2>/dev/null; then
      echo "❌ SSH-туннель упал. Лог:"
      echo "------"
      cat "$SSH_LOG"
      echo "------"
      URL="keeplog"
      break
    fi
    sleep 1
  done

  if [ "$URL" = "keeplog" ]; then
    URL=""
    echo "Подсказка: проверь интернет и попробуй снова. Если повторяется — sleep 60 и снова."
  elif [ -n "$URL" ]; then
    echo
    echo "═══════════════════════════════════════════════════"
    echo "  🌐 ПУБЛИЧНЫЙ URL:"
    echo "  $URL"
    echo "═══════════════════════════════════════════════════"
    echo
  else
    echo "⚠️  URL не появился за 30 секунд. Лог: $SSH_LOG"
    echo "------"
    cat "$SSH_LOG"
    echo "------"
  fi
fi

echo
echo "Сервер работает. Не закрывай это окно. Ctrl+C — остановить всё."
wait "$UV_PID"
