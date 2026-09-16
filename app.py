import webview
import threading
import uvicorn
import time
import requests
import sys
import os

# Add backend directory to sys.path so modules can be found
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

def start_server():
    print("Starting backend server...")
    # Run FastAPI server programmatically
    # We use log_level="warning" to avoid polluting the terminal
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, log_level="warning")

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
    # Bật server chạy trên một luồng riêng biệt (background thread)
    t = threading.Thread(target=start_server)
    t.daemon = True # Tự động tắt khi cửa sổ chính đóng lại
    t.start()

    url = f"http://127.0.0.1:8000/?_v={int(time.time())}"
    print("Waiting for server to start...")
    
    if not check_server(url):
        print("Error: Backend server did not start in time.")
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
