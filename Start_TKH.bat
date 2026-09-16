@echo off
title $TKH - Trading Dashboard
color 0b

echo ===================================================
echo             $TKH DASHBOARD 
echo ===================================================
echo.
echo [1/3] Kiem tra ket noi MetaTrader 5...
echo Vui long dam bao MT5 cua ban dang mo va da dang nhap!
echo.

:: Cho server backend (FastAPI) chay o che do hien thi log
echo [2/3] Dang khoi dong Backend Server...
echo.

:: Mo trinh duyet sau 3 giay (chay ngam bang lenh ping)
start /b cmd /c "ping localhost -n 4 >nul && start http://localhost:8000"

echo [3/3] Mo trinh duyet (http://localhost:8000)...
echo De tat ung dung, hay dong cua so nay.
echo ===================================================
echo.

:: Chuyen huong vao thu muc backend va chay server
cd backend
python main.py

pause
