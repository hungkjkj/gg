"""Resolve writable data and packaged frontend paths for the app runtime."""

import os
import sys


def get_data_dir():
    configured_dir = os.environ.get("TOOL_TRADE_DATA_DIR")
    if configured_dir:
        data_dir = configured_dir
    elif getattr(sys, "frozen", False):
        local_app_data = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        data_dir = os.path.join(local_app_data, "TOOL TRADE")
    else:
        data_dir = os.path.dirname(os.path.abspath(__file__))

    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def get_data_file(filename):
    return os.path.join(get_data_dir(), filename)


def get_frontend_dist_dir():
    if getattr(sys, "frozen", False):
        bundle_root = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        return os.path.join(bundle_root, "frontend", "dist")

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(backend_dir), "frontend", "dist")
