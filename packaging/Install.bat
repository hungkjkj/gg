@echo off
setlocal
title TOOL TRADE MT5 - Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
if errorlevel 1 (
    echo.
    echo Cai dat that bai. Hay chup man hinh loi va gui lai de duoc ho tro.
    pause
)
endlocal
