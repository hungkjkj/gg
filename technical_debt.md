# Cấu trúc dự án và Technical Debt (Nợ Kỹ Thuật)

Dự án hiện tại là một Hệ thống Phân tích Giao dịch (Trading Tool) toàn diện, bao gồm một Backend chạy bằng Python/FastAPI giao tiếp trực tiếp với MetaTrader 5 (MT5) để lấy dữ liệu real-time, và một Frontend xây dựng bằng React (Vite) sử dụng Lightweight-Charts để vẽ biểu đồ và phân tích Động lượng (Momentum).

## 1. Cấu trúc Hệ thống Hiện tại
* **`app.py`**: Điểm khởi đầu (Entry Point) của Desktop App, quản lý cửa sổ WebView hiển thị giao diện.
* **`backend/`**:
  * `main.py`: Chứa các API endpoints (FastAPI) để cung cấp dữ liệu nến, ma trận sức mạnh, tin tức, lịch kinh tế, và các tiến trình (background tasks).
  * `mt5_service.py`: Chịu trách nhiệm kết nối với MetaTrader 5, truy xuất dữ liệu nến thô (raw data), tính toán chỉ số sức mạnh thị trường (GLOBAL_INDEX bằng mô hình trung bình nhân hình học).
  * `data_fetcher.py`: Xử lý lấy tin tức, dữ liệu thị trường từ các nguồn bên ngoài hoặc cấu hình.
  * Các file JSON (`app_configs.json`, `alerts.json`): Lưu trữ cấu hình người dùng và dữ liệu cảnh báo cục bộ.
* **`frontend/`**:
  * `src/App.jsx`: Component React chính điều phối toàn bộ giao diện, bao gồm quản lý Chart (Lightweight-Charts), gọi API, xử lý Backtest, hiển thị Ma trận và Bong bóng tin tức.
  * `src/components/MomFlip.jsx`: Component hiển thị Bảng ma trận nổi (Bubble Matrix), tính toán phân phối % và cấu hình dải SD.

## 2. Các Vấn đề Đã Giải Quyết (Resolved)
1. **Khôi phục File Quan trọng**: Đã khôi phục thành công `app.py` gốc làm điểm chạy ứng dụng desktop.
2. **UI Responsive**: Cập nhật `ResizeObserver` cho các biểu đồ (Main, Momentum, Volume) trong `App.jsx`, khắc phục triệt để tình trạng biểu đồ không tự co giãn khi bật/tắt các khung dưới, đồng thời bọc `try-catch` để chống lỗi `Object is disposed` khi thay đổi cặp tiền.
3. **Logic Màu sắc Bong bóng (MomFlip)**: Khôi phục mốc phân phối `50%` cho Động lượng (Lớn hơn 50% hiển thị Xanh, nhỏ hơn -50% hiển thị Đỏ), và dọn dẹp các nhãn text thừa ("Bật/Tắt").
4. **Đồng bộ hóa Ma trận**: Sửa lỗi sai tên tham số API (hours vs n_hours, volDays vs vol_days) giúp Bong bóng Ma trận cập nhật chính xác theo cấu hình của người dùng.
5. **Chỉ số Global Index (GI)**: Thay đổi thuật toán tính GI từ việc nghịch đảo DXY (phụ thuộc quá nặng vào EUR) sang mô hình **Trung bình nhân đồng trọng số (Equal-weight Geometric Mean)** của rổ 5 đồng tiền mạnh nhất vs USD.
6. **Thuật toán Mom Percentile**: Xóa bỏ phép nhân với Volume thô (Raw Volume) gây sai lệch, chuyển sang dùng **RVOL (Relative Volume)** nhân với Score để phân phối Động lượng (Momentum Percentile) phản ánh chính xác 100% lực cung/cầu.
7. **Lỗi Bong bóng tin tức (News Markers)**: Đồng bộ mốc thời gian (timeline) tương lai trong chế độ Backtest theo `simulatedTime`, ngăn chặn việc các tin tức bị co cụm lại với nhau ở cuối biểu đồ.

## 3. Nợ Kỹ Thuật (Technical Debt) Cần Xử Lý Trong Tương Lai
1. **Tái cấu trúc (Refactoring) Frontend**: 
   - Hiện tại `App.jsx` quá lớn (chứa logic fetch data, quản lý state, tính toán backtest, và render UI). Cần chia nhỏ các tính năng như `ChartManager`, `MatrixManager`, `NewsManager` thành các Custom Hooks hoặc Components riêng biệt để dễ bảo trì.
2. **Quản lý Cache Backend**: 
   - Nên chuyển việc cache trên Backend từ RAM đơn thuần (dictionary) sang một công cụ chuyên dụng (như Redis hoặc SQLite) nếu hệ thống mở rộng, giúp giải phóng bộ nhớ và tăng tốc độ tính toán cho nhiều biểu đồ cùng lúc.
3. **Khớp nối Thời gian (Timezone Alignment)**: 
   - Đôi khi dữ liệu nến H1 của MT5 và dữ liệu Tin tức có sự sai lệch múi giờ nếu người dùng cấu hình sai Broker Timezone. Cần một cơ chế tự động dò tìm (auto-detect) múi giờ của Broker MT5.
4. **Tối ưu hóa Data Fetching**: 
   - Frontend hiện dùng setInterval kết hợp với Axios fetching khá nhiều. Xem xét sử dụng WebSockets cho luồng dữ liệu thời gian thực (Real-time price & volume ticks) để giảm tải các request HTTP lặp đi lặp lại.
5. **Quản lý State Toàn cục (Global State)**: 
   - Cân nhắc sử dụng Zustand, Redux hoặc Context API thay cho việc truyền State loạn xạ qua các Refs và Prop-drilling hiện tại.

## 4. Dọn Dẹp File
- Toàn bộ các file nháp (scratch), file test sinh ra trong quá trình gỡ lỗi đều đã được xóa bỏ hoàn toàn. Workspace hiện tại 100% sạch sẽ và thuần túy code sản xuất (production).
