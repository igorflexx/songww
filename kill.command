#!/usr/bin/env bash

echo "→ Гашу uvicorn..."
pkill -9 -f "uvicorn backend.main" 2>/dev/null && echo "  ✓ uvicorn остановлен" || echo "  · uvicorn не работал"

ORPHANS=$(lsof -t -i :8000 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$ORPHANS" ]; then
  echo "→ Гашу осиротевшие воркеры на порту 8000: $ORPHANS"
  echo "$ORPHANS" | xargs kill -9 2>/dev/null || true
fi

echo "→ Гашу SSH-туннели localhost.run..."
pkill -f "ssh.*localhost.run" 2>/dev/null && echo "  ✓ туннель закрыт" || echo "  · туннелей не было"

echo "→ Гашу autossh (если был)..."
pkill -f "autossh.*localhost.run" 2>/dev/null && echo "  ✓ autossh остановлен" || echo "  · autossh не работал"

echo "→ Гашу cloudflared (если был)..."
pkill -f "cloudflared tunnel" 2>/dev/null && echo "  ✓ cloudflared остановлен" || echo "  · cloudflared не работал"

echo "Готово."
