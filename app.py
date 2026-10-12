import webview
import subprocess
import time
import requests
import sys
import os

# Add backend directory to sys.path so modules can be found
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import socket

def find_free_port(start_port=8000, max_port=8100):
    for port in range(start_port, max_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except socket.error:
                continue
    return 8000

def check_server(url, health_url=None, process=None, timeout=60):
    start_time = time.time()
    last_print = 0
    target_check = health_url or url
    while time.time() - start_time < timeout:
        # Kiểm tra xem tiến trình backend có bị tắt/lỗi sớm không
        if process and process.poll() is not None:
            print(f"[LỖI] Tiến trình backend kết thúc sớm với mã thoát: {process.returncode}")
            return False

        try:
            r = requests.get(target_check, timeout=2)
            if r.status_code == 200:
                elapsed = time.time() - start_time
                print(f"[OK] Backend server sẵn sàng sau {elapsed:.2f} giây.")
                return True
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            pass

        elapsed = time.time() - start_time
        if elapsed - last_print >= 3.0:
            print(f"Đang chờ backend server khởi động... ({int(elapsed)}s / {timeout}s)")
            last_print = elapsed

        time.sleep(0.5)
    return False

if __name__ == '__main__':
    # Bật server chạy trên một process riêng biệt để tránh kẹt giao diện UI
    print("Khởi động backend server trên tiến trình riêng...")
    backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
    port = find_free_port()
    print(f"Cổng khả dụng: {port}")
    backend_process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=backend_dir
    )
    
    try:
        url = f"http://127.0.0.1:{port}/?_v={int(time.time())}"
        health_url = f"http://127.0.0.1:{port}/api/v1/health"
        print("Đang kiểm tra trạng thái khởi động backend...")
        
        if not check_server(url, health_url=health_url, process=backend_process, timeout=60):
            print("Lỗi: Backend server không khởi động kịp thời gian quy định (Timeout 60s).")
            backend_process.terminate()
            sys.exit(1)
            
        print("Backend đã hoạt động! Đang mở cửa sổ ứng dụng Desktop...")

        # Mở cửa sổ Desktop bằng pywebview
        webview.create_window(
            'TOOL TRADE MT5', 
            url, 
            width=1200, 
            height=800,
            min_size=(800, 600)
        )
        
        # Bắt đầu vòng lặp sự kiện giao diện người dùng
        webview.start()
    finally:
        # Tự động tắt server khi app đóng lại
        print("Đang đóng ứng dụng, tắt tiến trình backend...")
        backend_process.terminate()
        try:
            backend_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            backend_process.kill()
