@echo off
echo Starting Window 3D local web server on http://localhost:8000 ...

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node server.js
    goto :eof
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python -m http.server 8000
    goto :eof
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    py -m http.server 8000
    goto :eof
)

if exist "C:\msys64\ucrt64\bin\python.exe" (
    "C:\msys64\ucrt64\bin\python.exe" -m http.server 8000
    goto :eof
)

where npx >nul 2>nul
if %ERRORLEVEL% equ 0 (
    npx serve -l 8000 .
    goto :eof
)

echo Error: Neither Python nor Node/npx was found in PATH.
echo Please run python -m http.server 8000 or install Python from python.org.
pause
