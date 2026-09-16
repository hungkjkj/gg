đây là ý tưởng về dashboard của tôi 

đầu tiên là file indi2 có 2 chỉ báo trong 1 file (1 cái là tỉ lệ vol theo median, 1 cái là chỉ báo động lượng) tôi cần bạn tách nó ra thành 2 chỉ báo riêng biệt

thứ 2 là chart cho phép tương tác như trên tradingview (zoom, di chuyển, đổi timeframe, đổi cặp tiền tệ, ....), và chọn loại biểu đồ (candle, line (close), hlc)

thứ 3 là viết 1 ma trận so sánh các cặp tiền tệ với nhau nhằm tìm ra đồng tiền mạnh nhất và đồng tiền yếu nhất (đưa ra bảng xếp hạng các cặp major từ mạnh xuống yếu), có thể so sánh đường vwma của các cặp tiền tệ với nhau (hiệu điểm giá trị cuối của vwma và giá trị tại nến đầu tiên trong cửa sổ N tiếng) trong khoảng thời gian N tiếng (tùy chỉnh N) và có thể chọn N thủ công hoặc theo các mốc thời gian có sẵn (1h, 2h, 4h, 8h, 16h, 24h, 48h, 72h, 168h) 

thứ 4 là các chỉ báo cho phép nhập và chỉnh sửa các thông số đầu vào, cài đặt, màu sắc, loại biểu đố của 3 chỉ báo,... như tradingview

thứ 5 là chế độ backtest, nếu người dùng chọn hiện tại thì chart cứ chạy cây nến mới nhất như bình thường 
nếu người dùng chọn 1 ngày bất kì để backtest (ví dụ chọn ngày 10/11/2024) thì chart sẽ quay lại thời điểm ngày hôm đó và chạy nến như bình thường và không thay đổi chart khi người dùng di chuyển hay zoom (tải 100k nến từ thời điểm đó trở về sau và có nút chạy nến (có nút dừng, tua nhanh, .... còn nếu người dùng chọn hiện tại thì nút này không hoạt động))