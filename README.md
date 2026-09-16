# TOOL TRADE MT5 - Hướng Dẫn Sử Dụng

Đây là hệ thống Tool Trade dựa trên nền tảng MetaTrader 5 (MT5). Hệ thống này đã được đóng gói thành một Ứng dụng Desktop độc lập (Desktop App) vô cùng tiện lợi và có thể dễ dàng chạy trên bất kỳ máy tính Windows nào.

## YÊU CẦU HỆ THỐNG
1. Máy tính chạy hệ điều hành Windows.
2. Đã cài đặt phần mềm **MetaTrader 5 (MT5)** và đang đăng nhập vào một tài khoản giao dịch.
3. Đã cài đặt **Python 3.10** trở lên. 
*(Nếu chưa có Python, vui lòng tải từ python.org và nhớ tick vào ô **"Add Python to PATH"** lúc cài đặt).*

---

## HƯỚNG DẪN CÀI ĐẶT

### Bước 1: Cài đặt Expert Advisor (EA) vào MT5
Hệ thống sử dụng một EA có tên là `DataServer.mq5` làm phương án dự phòng (fallback) để xuất dữ liệu khi Python API bị lỗi.
1. Mở phần mềm MT5 lên.
2. Bấm vào menu **File -> Open Data Folder**.
3. Truy cập vào thư mục `MQL5\Experts\`.
4. Copy file `DataServer.mq5` từ thư mục `EA` của Tool Trade này và dán vào thư mục `Experts` vừa mở.
5. Mở thẻ **Navigator** trong MT5 (bấm Ctrl+N), chuột phải vào mục **Expert Advisors** và chọn **Refresh**.
6. Kéo thả EA `DataServer` vào bất kỳ biểu đồ nào trên MT5 để kích hoạt (chỉ cần chạy trên 1 biểu đồ là đủ). Đảm bảo nút "Algo Trading" trên thanh công cụ MT5 đang bật (màu xanh).

### Bước 2: Khởi động Tool Trade
1. Đảm bảo MT5 vẫn đang mở và đang chạy.
2. Click đúp chuột vào file `start.bat` trong thư mục Tool Trade này.
3. Trong lần đầu tiên chạy, hệ thống sẽ mất khoảng 1-2 phút để tự động tải các thư viện cần thiết.
4. Một cửa sổ phần mềm độc lập sẽ tự động bật lên hiển thị Biểu đồ và Tin tức.

---

## CÁC TÍNH NĂNG CHÍNH
- **Đồng bộ với MT5:** Tự động nhận diện phần mềm MT5 đang chạy để trích xuất dữ liệu giá.
- **Biểu đồ mượt mà:** Khả năng zoom, di chuyển mượt mà.
- **Phân tích Khối lượng & Động lượng:** Chỉ báo tuỳ chỉnh dưới dạng heatmap, lưới điểm, và bộ lọc màu nến thông minh theo dòng tiền.
- **Tin tức Forex Factory:** Tự động lấy tin tức và đính kèm trực tiếp lên trục thời gian của biểu đồ (hiển thị quả bóng tin tức).
- **Tùy biến giờ giấc:** Bảng thông tin Settings cho phép người dùng nhập tay `timeShiftHours` để đồng bộ giờ sàn (Broker) về đúng giờ địa phương mong muốn.

---

Chúc bạn giao dịch thành công!
"# gg" 
