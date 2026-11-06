@echo off
rem Starts a local server for Peekaboo on http://localhost:8000
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node "%~dp0server.js"
    goto :eof
)
rem No Node: fall back to Python's static server (run "node scripts\fetch-assets.mjs" once for the 3D models).
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    py -m http.server 8000 --bind 127.0.0.1
    goto :eof
)
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python -m http.server 8000 --bind 127.0.0.1
    goto :eof
)
echo Neither Node.js nor Python was found. Install Node.js 18+ from https://nodejs.org and run this again.
pause
