@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=8000"

call :prepare_env || exit /b 1
call :stop_port %PORT%

echo Starting server on http://127.0.0.1:%PORT%
echo.
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port %PORT% --reload
exit /b %errorlevel%

:prepare_env
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -m venv .venv || exit /b 1
  ) else (
    python -m venv .venv || exit /b 1
  )
)

echo Upgrading pip...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul || exit /b 1

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt || exit /b 1
exit /b 0

:stop_port
powershell -NoProfile -Command "$conns = Get-NetTCPConnection -LocalPort %1 -ErrorAction SilentlyContinue; if ($conns) { $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
timeout /t 1 /nobreak >nul
exit /b 0
