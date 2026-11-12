"""Organizer launcher: start the server if needed, then open the browser.

If the server already answers, only the browser opens: a second launch never starts a
second server. The server runs detached with no window:
  - Windows: with pythonw (launcher.vbs runs this file with pythonw);
  - macOS/Linux: with the same interpreter as this script, in its own session.

Optional flags (used for testing): --port N, --data DIR (passed on to server.py),
--no-browser.
"""

import argparse
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "server.py")
WINDOWS = sys.platform.startswith("win")


def ping(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "api/ping", timeout=0.5) as r:
            return r.status == 200
    except Exception:
        return False


def interpreter() -> str:
    """pythonw next to the running interpreter on Windows, else the interpreter itself."""
    if WINDOWS:
        here = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        if os.path.exists(here):
            return here
    return sys.executable


def start_server(extra: list) -> None:
    common = dict(
        cwd=HERE,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    cmd = [interpreter(), SERVER] + extra
    if WINDOWS:
        flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
                 | subprocess.CREATE_NEW_PROCESS_GROUP)
        subprocess.Popen(cmd, creationflags=flags, **common)
    else:
        subprocess.Popen(cmd, start_new_session=True, **common)


def main() -> None:
    ap = argparse.ArgumentParser(description="Organizer launcher")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", default=None)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    url = f"http://127.0.0.1:{args.port}/"
    extra = ["--port", str(args.port)]
    if args.data:
        extra += ["--data", os.path.abspath(args.data)]

    if not ping(url):
        start_server(extra)
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and not ping(url):
            time.sleep(0.15)
    if not args.no_browser:
        webbrowser.open(url)


if __name__ == "__main__":
    main()
