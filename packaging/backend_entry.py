"""Frozen executable entry point for the local FastAPI service."""

import argparse
import uvicorn

import main


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int, nargs="?", default=8000)
    options = parser.parse_args()
    uvicorn.run(main.app, host="127.0.0.1", port=options.port, log_level="warning")


if __name__ == "__main__":
    run()
