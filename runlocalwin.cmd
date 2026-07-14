@echo off
setlocal EnableExtensions
title igor-first-project local launcher

call :main
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Script finished with code %EXIT_CODE%.
  echo Press any key to close this window.
  pause >nul
)
exit /b %EXIT_CODE%

:main
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

echo Installing dependencies...
call :install_requirements || exit /b 1
exit /b 0

:install_requirements
set "NO_PROXY=*"
set "no_proxy=*"
set "ALL_PROXY="
set "all_proxy="
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt || exit /b 1
exit /b 0

:stop_port
powershell -NoProfile -Command "$conns = Get-NetTCPConnection -LocalPort %1 -ErrorAction SilentlyContinue; if ($conns) { $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
timeout /t 1 /nobreak >nul
exit /b 0
