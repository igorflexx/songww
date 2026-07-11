#!/usr/bin/env bash

cd "$(dirname "$0")"

echo "→ Гашу uvicorn..."
pkill -9 -f "uvicorn backend.main" 2>/dev/null && echo "  ✓ uvicorn остановлен" || echo "  · uvicorn не работал"

ORPHANS=$(lsof -t -i :8000 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$ORPHANS" ]; then
  echo "→ Гашу осиротевшие процессы на порту 8000: $ORPHANS"
  echo "$ORPHANS" | xargs kill -9 2>/dev/null || true
fi

echo "Готово."
