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

def check_server(url, timeout=10):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            r = requests.get(url)
            if r.status_code == 200:
                return True
        except requests.exceptions.ConnectionError:
            time.sleep(0.5)
    return False

if __name__ == '__main__':
    # Bật server chạy trên một process riêng biệt để tránh kẹt giao diện UI
    print("Starting backend server in a separate process...")
    backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
    port = find_free_port()
    print(f"Found free port: {port}")
    backend_process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=backend_dir
    )
    
    try:
        url = f"http://127.0.0.1:{port}/?_v={int(time.time())}"
        print("Waiting for server to start...")
        
        if not check_server(url):
            print("Error: Backend server did not start in time.")
            backend_process.terminate()
            sys.exit(1)
            
        print("Server started successfully! Launching Desktop Window...")

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
        print("Closing application, terminating backend server...")
        backend_process.terminate()
        try:
            backend_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            backend_process.kill()
