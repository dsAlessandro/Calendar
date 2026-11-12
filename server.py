"""Organizer: local study planner.

Stdlib-only HTTP server on 127.0.0.1. It serves the static UI and keeps the
whole data document in data/organizer.json.

    GET  /api/ping       -> {"ok": true}
    GET  /api/data       -> the whole document
    PUT  /api/data       -> replace the whole document (atomic write + daily backup)
    POST /api/shutdown   -> answer, then stop the server

Run with pythonw so no console appears. Optional flags (used for testing):
    --port N        default 8765
    --data DIR      default <this folder>/data
"""

from __future__ import annotations  # "str | None" hints on Python 3.9 (stock macOS python3)

import argparse
import datetime as dt
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
EMPTY_DOC = {"activities": [], "series": [], "todos": []}
BACKUPS_KEPT = 30
MAX_BODY = 20 * 1024 * 1024


class Store:
    """The JSON document on disk. One lock serialises reads and writes."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.path = data_dir / "organizer.json"
        self.backup_dir = data_dir / "backup"
        self.lock = threading.Lock()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write_atomic(EMPTY_DOC)

    def read_bytes(self) -> bytes:
        with self.lock:
            return self.path.read_bytes()

    def save(self, doc: dict) -> str | None:
        with self.lock:
            backup = self._daily_backup()
            self._write_atomic(doc)
            return backup

    def _daily_backup(self) -> str | None:
        """Before the first save of the day, copy the current file to backup/.

        The copy holds the state as it was when the day started, which is the
        useful restore point. Only the newest BACKUPS_KEPT copies are kept.
        """
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        name = f"organizer-{dt.date.today().isoformat()}.json"
        target = self.backup_dir / name
        if target.exists() or not self.path.exists():
            return None
        shutil.copy2(self.path, target)
        copies = sorted(self.backup_dir.glob("organizer-????-??-??.json"))
        for old in copies[:-BACKUPS_KEPT]:
            old.unlink(missing_ok=True)
        return name

    def _write_atomic(self, doc: dict) -> None:
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        fd, tmp = tempfile.mkstemp(prefix=".organizer-", suffix=".tmp", dir=self.data_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
                fh.flush()
                os.fsync(fh.fileno())
            # Windows refuses the rename while another process (antivirus, a reader,
            # an editor) has the target open: retry briefly before giving up.
            for attempt in range(40):
                try:
                    os.replace(tmp, self.path)
                    break
                except PermissionError:
                    if attempt == 39:
                        raise
                    time.sleep(0.05)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


def validate(doc) -> str | None:
    if not isinstance(doc, dict):
        return "document must be an object"
    for key in EMPTY_DOC:
        if not isinstance(doc.get(key), list):
            return f"'{key}' must be a list"
    return None


class Handler(SimpleHTTPRequestHandler):
    store: Store = None  # set in main()
    # Fixed types: on Windows the registry can map .js to text/plain.
    extensions_map = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    # pythonw has no stderr: the default logger would crash.
    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, status, payload) -> None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/ping":
            return self._json(HTTPStatus.OK, {"ok": True, "app": "organizer"})
        if path == "/api/data":
            return self._json(HTTPStatus.OK, self.store.read_bytes())
        if path.startswith("/api/"):
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        return super().do_GET()

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/data":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "bad length"})
        try:
            doc = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": f"invalid json: {exc}"})
        problem = validate(doc)
        if problem:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": problem})
        try:
            backup = self.store.save(doc)
        except OSError as exc:
            return self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"save failed: {exc}"})
        return self._json(HTTPStatus.OK, {"ok": True, "backup": backup})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/shutdown":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        self._json(HTTPStatus.OK, {"ok": True})
        # Every save is already on disk, so stopping is enough.
        threading.Thread(target=self.server.shutdown, daemon=True).start()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second process bind the same port:
    # use exclusive binding instead, so a second server fails to start.
    allow_reuse_address = not sys.platform.startswith("win")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main() -> int:
    ap = argparse.ArgumentParser(description="Organizer local server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    args = ap.parse_args()

    Handler.store = Store(args.data.resolve())
    try:
        httpd = Server(("127.0.0.1", args.port), Handler)
    except OSError:
        return 1  # port taken: another instance is already running
    with httpd:
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
