@echo off
setlocal EnableExtensions
title igor-first-project public launcher

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
set "UVICORN_OUT=%CD%\.runwin-uvicorn.out.log"
set "UVICORN_ERR=%CD%\.runwin-uvicorn.err.log"
set "SSH_OUT=%CD%\.runwin-ssh.out.log"
set "SSH_ERR=%CD%\.runwin-ssh.err.log"
set "UVICORN_PID_FILE=%CD%\.runwin-uvicorn.pid"
set "SSH_PID_FILE=%CD%\.runwin-ssh.pid"
set "PUBLIC_URL="

call :prepare_env || exit /b 1
call :stop_port %PORT%

del "%UVICORN_OUT%" >nul 2>nul
del "%UVICORN_ERR%" >nul 2>nul
del "%SSH_OUT%" >nul 2>nul
del "%SSH_ERR%" >nul 2>nul

echo Starting local server...
for /f %%I in ('powershell -NoProfile -Command "$p = Start-Process -FilePath '.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000','--reload' -WorkingDirectory '.' -RedirectStandardOutput '.runwin-uvicorn.out.log' -RedirectStandardError '.runwin-uvicorn.err.log' -PassThru; $p.Id"') do set "UVICORN_PID=%%I"

if not defined UVICORN_PID (
  echo [ERROR] Failed to start uvicorn.
  exit /b 1
)

> "%UVICORN_PID_FILE%" echo %UVICORN_PID%

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(20); while((Get-Date)-lt $deadline){ try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%PORT%/' | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo [ERROR] Uvicorn did not become ready.
  echo Logs: %UVICORN_OUT% and %UVICORN_ERR%
  call :cleanup
  exit /b 1
)

where ssh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] OpenSSH client was not found in PATH.
  call :cleanup
  exit /b 1
)

echo Opening localhost.run tunnel...
for /f %%I in ('powershell -NoProfile -Command "$p = Start-Process -FilePath 'ssh' -ArgumentList '-o','StrictHostKeyChecking=accept-new','-o','ServerAliveInterval=30','-o','ExitOnForwardFailure=yes','-R','80:localhost:8000','nokey@localhost.run' -WorkingDirectory '.' -RedirectStandardOutput '.runwin-ssh.out.log' -RedirectStandardError '.runwin-ssh.err.log' -PassThru; $p.Id"') do set "SSH_PID=%%I"

if not defined SSH_PID (
  echo [ERROR] Failed to start the SSH tunnel.
  call :cleanup
  exit /b 1
)

> "%SSH_PID_FILE%" echo %SSH_PID%

for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(30); $url=''; while((Get-Date)-lt $deadline -and -not $url){ $text=''; if(Test-Path '.runwin-ssh.out.log'){ $text += Get-Content '.runwin-ssh.out.log' -Raw }; if(Test-Path '.runwin-ssh.err.log'){ $text += [Environment]::NewLine + (Get-Content '.runwin-ssh.err.log' -Raw) }; $m=[regex]::Match($text,'https://[a-z0-9-]+\.lhr\.life'); if($m.Success){ $url=$m.Value; break }; Start-Sleep -Seconds 1 }; if($url){ Write-Output $url }"`) do set "PUBLIC_URL=%%U"

echo.
if defined PUBLIC_URL (
  echo Public URL:
  echo %PUBLIC_URL%
) else (
  echo Tunnel started, but the public URL was not detected automatically yet.
  echo Check logs: %SSH_OUT% and %SSH_ERR%
)
echo.
echo Press any key to stop the server and tunnel.
pause >nul

call :cleanup
exit /b 0

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

:cleanup
set "SSH_PID="
set "UVICORN_PID="

if exist "%SSH_PID_FILE%" set /p SSH_PID=<"%SSH_PID_FILE%"
if defined SSH_PID powershell -NoProfile -Command "Stop-Process -Id %SSH_PID% -Force -ErrorAction SilentlyContinue"

if exist "%UVICORN_PID_FILE%" set /p UVICORN_PID=<"%UVICORN_PID_FILE%"
if defined UVICORN_PID powershell -NoProfile -Command "Stop-Process -Id %UVICORN_PID% -Force -ErrorAction SilentlyContinue"

del "%SSH_PID_FILE%" >nul 2>nul
del "%UVICORN_PID_FILE%" >nul 2>nul
exit /b 0
