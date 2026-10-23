# TOOL TRADE MT5

Ứng dụng phân tích giao dịch kết nối với MetaTrader 5, gồm giao diện desktop, biểu đồ, Currency Matrix, cảnh báo và các công cụ phân tích.

## Cài đặt trên máy Windows khác

Máy chạy ứng dụng không cần cài Python hoặc Node.js. Tải và giải nén `TOOL-TRADE-Installer.zip`, sau đó chạy `Install.bat`. Bộ cài sẽ chép ứng dụng vào thư mục người dùng, tạo shortcut và cài Microsoft Edge WebView2 Runtime nếu máy còn thiếu và có kết nối Internet.

Ứng dụng cần MetaTrader 5 của broker được cài riêng và đăng nhập tài khoản để lấy dữ liệu thị trường. Không gộp MT5 vào bộ cài vì mỗi broker có phiên bản terminal và máy chủ riêng. `EA/DataServer.mq5` chỉ là thành phần dự phòng tùy chọn.

Cài đặt, cảnh báo, chiến lược và nhật ký được lưu trong `%LOCALAPPDATA%\TOOL TRADE`.

## Tạo bộ cài Windows

Trên máy build Windows 64-bit, chạy PowerShell:

```powershell
& .\packaging\build_windows.ps1
```

Script tự build giao diện, đóng gói frontend/backend thành ứng dụng độc lập và tạo:

- `release/windows/TOOL-TRADE-Installer.zip` để chuyển sang máy khác.
- `release/windows/TOOL-TRADE-Installer/` để chạy thử bộ cài trực tiếp.

Máy build cần Node.js và Python 3.12; script sử dụng `.venv` hoặc tạo môi trường build riêng. Các yêu cầu này chỉ dành cho máy đóng gói, không dành cho máy cài ứng dụng.

## Chạy từ mã nguồn

Khi phát triển, backend chạy bằng Python/FastAPI và frontend bằng React/Vite. Dùng `Start_TKH.bat` để chạy backend theo cách hiện tại.
