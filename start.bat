@echo off
title TOOL TRADE MT5 - Khởi động Hệ thống
color 0A

:: Đảm bảo thư mục làm việc luôn là thư mục chứa script (tránh lỗi Run as Admin)
cd /d "%~dp0"
echo ===================================================
echo             TOOL TRADE MT5 - DESKTOP APP
echo ===================================================
echo.

:: Kiểm tra xem Python đã cài đặt chưa
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LỖI] Khong tim thay Python tren he thong.
    echo Vui long cai dat Python ^(hoac tich vao o "Add Python to PATH" khi cai dat^).
    echo.
    pause
    exit /b
)

:: Kiểm tra xem thư mục ảo .venv đã có chưa
if not exist ".venv\Scripts\activate.bat" (
    echo [THONG BAO] Dang tao moi truong ao ^(Virtual Environment^) lan dau tien...
    python -m venv .venv
    echo.
)

:: Kích hoạt môi trường ảo
echo [THONG BAO] Dang khoi dong moi truong ao...
call .venv\Scripts\activate.bat

:: Cài đặt/cập nhật thư viện
echo [THONG BAO] Dang kiem tra va cap nhat cac thu vien can thiet...
pip install -r requirements.txt
echo.

:: Chạy Desktop App
echo [THONG BAO] Dang khoi dong Desktop App. Vui long doi vai giay...
python app.py

:: Kết thúc
pause
