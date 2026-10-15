@echo off
setlocal
chcp 65001 >nul 2>nul
title Cek NIK - Server Lokal
cd /d "%~dp0"

rem Browser dibuka otomatis. Kalau tidak mau:  jalankan_server.bat --no-open
set "OPEN=1"
if /i "%~1"=="--no-open" set "OPEN=0"

rem Port default 8788. PORT dari lingkungan dipakai hanya bila angkanya valid,
rem karena di sebagian sistem PORT=0 sudah ter-set lebih dulu (itu tidak valid).
if not defined PORT set "PORT=8788"
echo(%PORT%| findstr /r /c:"^[1-9][0-9]*$" >nul || set "PORT=8788"
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo   Cek NIK - server lokal
echo   Folder : %~dp0
echo   URL    : %URL%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js belum ada di PC ini.
  echo   Install dulu dari https://nodejs.org  lalu jalankan file ini lagi.
  echo.
  pause
  exit /b 1
)

rem Kalau server sudah jalan, cukup buka browser - jangan dijalankan dua kali.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri '%URL%api/health'; if ($r.Content -match 'ok') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo   Server sudah berjalan - membuka browser...
  if "%OPEN%"=="1" start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

echo   Menyalakan server, mohon tunggu sebentar...
if "%OPEN%"=="1" start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process '%URL%'"
echo   Tekan Ctrl+C di jendela ini untuk menghentikan server.
echo.

node server.js
set "RC=%errorlevel%"

echo.
if not "%RC%"=="0" (
  echo   Server berhenti dengan pesan error di atas - bacanya dulu.
) else (
  echo   Server sudah berhenti.
)
echo   Tekan sembarang tombol untuk menutup jendela...
pause >nul
exit /b %RC%
