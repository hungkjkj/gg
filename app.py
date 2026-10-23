import webview
import subprocess
import time
import requests
import sys
import os
from pathlib import Path

if not getattr(sys, "frozen", False):
    # Add backend directory to sys.path for source/development runs.
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


def show_startup_error(message):
    if getattr(sys, "frozen", False) and os.name == "nt":
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "TOOL TRADE MT5", 0x10)
    else:
        print(message)

def run_app():
    # Bật server chạy trên một process riêng biệt để tránh kẹt giao diện UI
    print("Khởi động backend server trên tiến trình riêng...")
    packaged = getattr(sys, "frozen", False)
    install_dir = Path(sys.executable).resolve().parent if packaged else Path(__file__).resolve().parent
    backend_dir = install_dir / "backend"
    port = find_free_port()
    print(f"Cổng khả dụng: {port}")
    if packaged:
        backend_executable = backend_dir / "ToolTradeBackend.exe"
        if not backend_executable.is_file():
            show_startup_error(f"Không tìm thấy backend của ứng dụng tại:\n{backend_executable}\n\nHãy chạy lại bộ cài TOOL TRADE.")
            return 1
        launch_command = [str(backend_executable), str(port)]
        environment = os.environ.copy()
        local_app_data = environment.get("LOCALAPPDATA") or str(Path.home())
        environment["TOOL_TRADE_DATA_DIR"] = str(Path(local_app_data) / "TOOL TRADE")
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    else:
        launch_command = [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"]
        environment = None
        creation_flags = 0

    backend_process = None
    try:
        backend_process = subprocess.Popen(
            launch_command,
            cwd=str(backend_dir),
            env=environment,
            creationflags=creation_flags,
        )
        url = f"http://127.0.0.1:{port}/?_v={int(time.time())}"
        health_url = f"http://127.0.0.1:{port}/api/v1/health"
        print("Đang kiểm tra trạng thái khởi động backend...")
        
        if not check_server(url, health_url=health_url, process=backend_process, timeout=60):
            show_startup_error("Không khởi động được backend trong 60 giây. Hãy kiểm tra MT5 và thử mở lại ứng dụng.")
            return 1
            
        print("Backend đã hoạt động! Đang mở cửa sổ ứng dụng Desktop...")

        try:
            # Create and start the desktop window after the local backend is ready.
            webview.create_window(
                'TOOL TRADE MT5',
                url,
                width=1200,
                height=800,
                min_size=(800, 600)
            )
            webview.start()
        except Exception as error:
            show_startup_error(
                "Không thể mở giao diện ứng dụng. Hãy đảm bảo Microsoft Edge WebView2 Runtime đã được cài đặt.\n\n"
                f"Chi tiết: {error}"
            )
            return 1
        return 0
    except Exception as error:
        show_startup_error(f"Không thể khởi động TOOL TRADE MT5.\n\nChi tiết: {error}")
        return 1
    finally:
        # Tự động tắt server khi app đóng lại
        if backend_process and backend_process.poll() is None:
            print("Đang đóng ứng dụng, tắt tiến trình backend...")
            backend_process.terminate()
            try:
                backend_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                backend_process.kill()


if __name__ == '__main__':
    sys.exit(run_app())
