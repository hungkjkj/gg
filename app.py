import webview
import subprocess
import time
import requests
import sys
import os
import threading
from collections import deque
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

def show_watchdog_notice(message):
    if getattr(sys, "frozen", False) and os.name == "nt":
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "TOOL TRADE MT5 - Tự khôi phục", 0x30)
    else:
        print(f"[WATCHDOG] {message}")

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
    process_lock = threading.Lock()
    stop_watchdog = threading.Event()
    watchdog_thread = None
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
            window = webview.create_window(
                'TOOL TRADE MT5',
                url,
                width=1200,
                height=800,
                min_size=(800, 600)
            )

            restart_times = deque()
            reload_times = deque()
            recovery_lock = threading.Lock()
            recovery_state = {
                "last_restart_at": 0.0,
                "restart_blocked": False,
                "reload_blocked": False,
                "last_reload_at": 0.0,
            }

            def stop_backend_process(process):
                if not process or process.poll() is not None:
                    return
                process.terminate()
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    process.kill()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        pass

            def start_backend_process():
                return subprocess.Popen(
                    launch_command,
                    cwd=str(backend_dir),
                    env=environment,
                    creationflags=creation_flags,
                )

            def wait_for_backend_ready(process, timeout=45):
                deadline = time.monotonic() + timeout
                while not stop_watchdog.is_set() and time.monotonic() < deadline:
                    if process is None or process.poll() is not None:
                        return False
                    try:
                        response = requests.get(health_url, timeout=2)
                        if response.status_code == 200 and response.json().get("status") == "ok":
                            return True
                    except (requests.RequestException, ValueError):
                        pass
                    stop_watchdog.wait(0.5)
                return False

            def restart_backend(reason):
                now = time.monotonic()
                with recovery_lock:
                    while restart_times and now - restart_times[0] > 900:
                        restart_times.popleft()
                    if recovery_state["restart_blocked"] or now - recovery_state["last_restart_at"] < 120:
                        return False
                    if len(restart_times) >= 3:
                        recovery_state["restart_blocked"] = True
                        show_watchdog_notice(
                            "Ứng dụng đã thử tự khởi động lại backend 3 lần trong 15 phút nhưng vẫn không ổn định. "
                            "Watchdog tạm dừng để tránh lặp vô hạn. Hãy kiểm tra kết nối MT5 rồi mở lại ứng dụng."
                        )
                        return False

                    recovery_state["last_restart_at"] = now
                    restart_times.append(now)
                    print(f"[WATCHDOG] Khởi động lại backend: {reason}")
                    with process_lock:
                        old_process = process_holder[0]
                        stop_backend_process(old_process)
                        try:
                            new_process = start_backend_process()
                        except Exception as error:
                            process_holder[0] = None
                            print(f"[WATCHDOG] Không khởi chạy lại được backend: {error}")
                            return False
                        process_holder[0] = new_process

                    ready = wait_for_backend_ready(process_holder[0])
                    if not ready:
                        print("[WATCHDOG] Backend chưa sẵn sàng sau khi khởi động lại.")
                        with process_lock:
                            failed_process = process_holder[0]
                            stop_backend_process(failed_process)
                            process_holder[0] = None
                        recovery_state["last_restart_at"] = time.monotonic() - 75
                        return False
                    print("[WATCHDOG] Backend đã phục hồi; giao diện sẽ kết nối lại tự động.")
                    return True

            def reload_frontend(reason):
                now = time.monotonic()
                with recovery_lock:
                    while reload_times and now - reload_times[0] > 900:
                        reload_times.popleft()
                    if recovery_state["reload_blocked"] or now - recovery_state["last_reload_at"] < 120:
                        return
                    if len(reload_times) >= 3:
                        recovery_state["reload_blocked"] = True
                        show_watchdog_notice(
                            "Giao diện đã bị treo nhiều lần; watchdog đã dừng tự tải lại để tránh vòng lặp. "
                            "Bạn có thể đóng rồi mở ứng dụng lại."
                        )
                        return
                    recovery_state["last_reload_at"] = now
                    reload_times.append(now)
                print(f"[WATCHDOG] Tải lại giao diện bị treo: {reason}")
                try:
                    window.load_url(url)
                except Exception as error:
                    print(f"[WATCHDOG] Không tải lại được giao diện: {error}")

            process_holder = [backend_process]

            def watchdog_loop():
                health_failures = 0
                while not stop_watchdog.wait(10):
                    with process_lock:
                        process = process_holder[0]
                    if process is None or process.poll() is not None:
                        health_failures = 3
                        restart_backend("tiến trình backend đã dừng")
                        continue

                    try:
                        response = requests.get(health_url, timeout=3)
                        response.raise_for_status()
                        health = response.json()
                        health_failures = 0
                    except (requests.RequestException, ValueError):
                        health_failures += 1
                        if health_failures >= 3:
                            restart_backend("backend không phản hồi health check")
                            health_failures = 0
                        continue

                    watchdog = health.get("watchdog") or {}
                    if (
                        watchdog.get("client_view_mode") == "chart"
                        and int(watchdog.get("live_poll_transport_failures") or 0) >= 6
                    ):
                        restart_backend("lấy dữ liệu nến live lỗi kết nối liên tiếp")
                        continue

                    heartbeat_age = watchdog.get("client_heartbeat_age_seconds")
                    if (
                        watchdog.get("client_visible") is True
                        and isinstance(heartbeat_age, (int, float))
                        and heartbeat_age >= 75
                    ):
                        reload_frontend("nhịp sống JavaScript quá hạn")

            watchdog_thread = threading.Thread(target=watchdog_loop, name="ToolTradeWatchdog", daemon=True)
            watchdog_thread.start()
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
        stop_watchdog.set()
        if watchdog_thread and watchdog_thread.is_alive():
            watchdog_thread.join(timeout=3)
        # Tự động tắt server khi app đóng lại
        if 'process_holder' in locals():
            backend_process = process_holder[0]
        if backend_process and backend_process.poll() is None:
            print("Đang đóng ứng dụng, tắt tiến trình backend...")
            backend_process.terminate()
            try:
                backend_process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                backend_process.kill()


if __name__ == '__main__':
    sys.exit(run_app())
