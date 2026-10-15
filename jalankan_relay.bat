@echo off
setlocal
chcp 65001 >nul 2>nul
title Cek NIK - Relai KPU (server + tunnel)
cd /d "%~dp0"

rem Relai untuk blog: worker Cloudflare tidak bisa menjangkau infopemilu.kpu.go.id
rem (firewall KPU menolak IP Cloudflare & Google), tapi IP PC ini diterima.
rem Arsitektur: blog -> worker Cloudflare -> tunnel ini -> server.js -> KPU.
rem Pastikan di cloudflare-worker.js:
rem   const KPU_RELAY = 'https://ceknik-relay-3311.loca.lt/relay?t=ceknik-relay-2026';
set "SUBDOMAIN=ceknik-relay-3311"
set "TUNNEL=https://ceknik-relay-3311.loca.lt"
set "TUNNEL_LOG=%~dp0tunnel.log"

if not defined PORT set "PORT=8788"
echo(%PORT%| findstr /r /c:"^[1-9][0-9]*$" >nul || set "PORT=8788"
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo   Cek NIK - relai KPU untuk blog (server + tunnel)
echo   Folder  : %~dp0
echo   Server  : %URL%
echo   Tunnel  : %TUNNEL%/relay
echo.
echo   Catatan:
echo   - Selama jendela ini terbuka, fitur SIPOL di blog hidup.
echo   - Jendela "Cek NIK - server" harus ikut terbuka (dibuka otomatis di bawah).
echo   - Tunnel dipantau tiap 2 menit; bila putus otomatis diulang.
echo   - npx bisa mengunduh paket lokaltunnel pada pertama kali (tunggu sebentar).
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js belum ada di PC ini.
  echo   Install dulu dari https://nodejs.org  lalu jalankan file ini lagi.
  echo.
  pause
  exit /b 1
)
where powershell >nul 2>nul
if errorlevel 1 (
  echo   PowerShell tidak ada - fitur pantauan tunnel tidak bisa jalan.
  echo.
  pause
  exit /b 1
)

rem --- 1) server.js: nyalakan bila belum jalan --------------------------------
call :cek_server
if not errorlevel 1 goto server_siap

echo   Menyalakan server.js di jendela terpisah...
start "Cek NIK - server" /min cmd /k "cd /d "%~dp0" && node server.js"

set /a TUNGGU=0
:tunggu_server
call :cek_server
if not errorlevel 1 goto server_siap
set /a TUNGGU+=1
if %TUNGGU% geq 15 goto server_gagal
ping -n 2 127.0.0.1 >nul
goto tunggu_server

:server_gagal
echo.
echo   Server tidak merespons dalam 15 detik - baca jendela "Cek NIK - server".
echo.
pause
exit /b 1

:server_siap
echo   Server siap.

rem --- 2) tunnel: nyalakan, pantau, ulang otomatis bila mati/zombie ------------
:mulai_tunnel
del "%TUNNEL_LOG%" 2>nul
echo.
echo   Menyalakan tunnel...  detik-detik pertama akan muncul baris:
echo       your url is: %TUNNEL%
echo.
echo   PENTING: URL-nya HARUS %TUNNEL%
echo   Bila yang muncul URL lain, subdomain sedang dipakai - jendela ini akan
echo   mengulang otomatis tiap 30 detik sampai dapat URL yang benar.
echo.
echo   Tekan Ctrl+C untuk menghentikan relai.
echo.
start "Tunnel Cek NIK" /b cmd /c "npx --yes localtunnel --port %PORT% --subdomain %SUBDOMAIN% >> "%TUNNEL_LOG%" 2>&1"

set /a TUNGGU=0
:tunggu_url
ping -n 3 127.0.0.1 >nul
if exist "%TUNNEL_LOG%" findstr /c:"your url is" "%TUNNEL_LOG%" >nul 2>nul
if not errorlevel 1 goto url_ketemu
set /a TUNGGU+=1
if %TUNGGU% geq 45 goto tunnel_gagal
goto tunggu_url

:url_ketemu
findstr /c:"%TUNNEL%" "%TUNNEL_LOG%" >nul 2>nul
if errorlevel 1 (
  echo   URL yang muncul BUKAN %TUNNEL% - subdomain dipakai pihak lain.
  echo   Mengulang dalam 30 detik...
  call :matikan_tunnel
  ping -n 31 127.0.0.1 >nul
  goto mulai_tunnel
)
ping -n 4 127.0.0.1 >nul
echo   Tunnel siap: %TUNNEL%
goto pantau

:tunnel_gagal
echo.
echo   Tunnel tidak kunjung siap dalam ~90 detik - cek koneksi internet,
echo   lalu jalankan ulang file ini.
echo.
call :matikan_tunnel
pause
exit /b 1

rem --- 3) pantauan rutin ------------------------------------------------------
:pantau
call :cek_server
if errorlevel 1 (
  echo   [%time%] server.js tidak merespons - jendela "Cek NIK - server" perlu dicek.
  ping -n 61 127.0.0.1 >nul
  goto pantau
)
call :cek_tunnel
if errorlevel 1 (
  echo   [%time%] tunnel mati/zombie - mengulang...
  call :matikan_tunnel
  goto mulai_tunnel
)
ping -n 121 127.0.0.1 >nul
goto pantau

rem --- subrutin ----------------------------------------------------------------
:cek_server
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri '%URL%api/health'; if ($r.Content -match 'ok') { exit 0 } } catch {}; exit 1" >nul 2>nul
exit /b %errorlevel%

:cek_tunnel
rem Dua kali percobaan biar tidak salah restart saat baru bangun.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 12 -Uri '%TUNNEL%/api/health'; if ($r.Content -match 'ok') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 exit /b 0
ping -n 4 127.0.0.1 >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 12 -Uri '%TUNNEL%/api/health'; if ($r.Content -match 'ok') { exit 0 } } catch {}; exit 1" >nul 2>nul
exit /b %errorlevel%

:matikan_tunnel
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'localtunnel' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
del "%TUNNEL_LOG%" 2>nul
exit /b 0
