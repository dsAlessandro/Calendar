# Organizer

A local study planner that runs in the browser and keeps everything on your own disk.
No account, no cloud, no third-party packages.

## Features

- Weekly grid with 30-minute slots (07:00-24:00, Monday first).
- Blocks with Title / Description / Results / Tags, a colour status and an optional colour.
- Weekly recurring activities, editable per occurrence (move, change, cancel one date) or
  as a whole series.
- A to-do panel whose items (Topic / Task) can be dragged onto the grid, grouped by topic.
  Its left edge is a handle: drag it to widen the panel, double-click it to reset the width
  (remembered per browser in `localStorage`, not in the data file).
- Copy and paste of single activities: **Copy** in the editor (not for recurring ones)
  enters paste mode; each click on a free slot pastes a copy there (same title, description,
  tags, colour and duration; empty results, not rated). It stays on across weeks until Esc,
  the x in the bar, or the Filter view. A paste that would overlap a block is refused.
- A Filter view by tag over a window around today.
- Every change is saved at once; a power button in the top bar stops the server.

## How it is built

A Python stdlib server (`server.py`, `http.server`) on `127.0.0.1:8765`, plain
HTML/CSS/JS in `static/`, and FullCalendar 6.1.15 vendored in `static/vendor/fullcalendar/`.
No packages, no build step. Python 3.9 or later (see `requirements.txt`).

| File | Role |
|---|---|
| `server.py` | HTTP server and JSON store. Options `--port N`, `--data DIR`. |
| `launcher.py` | Starts the server if it is not running (detached, no window), waits for `/api/ping`, opens the browser. Works on Windows, macOS and Linux. Options `--port`, `--data`, `--no-browser`. |
| `launcher.vbs` | Windows only: runs `launcher.py` with `pythonw` and no console window. |
| `setup/macos-setup.sh` | macOS only: builds `~/Applications/Organizer.app` (plus a Desktop link). |
| `setup/windows-shortcut.ps1` | Windows only: creates the Desktop shortcut with the app icon. |

Setup on a new machine: see [`SETUP.md`](SETUP.md).

## Start and stop

- **Start**: double-click `Organizer` (the Desktop shortcut on Windows, the app or its
  Desktop link on macOS). If the server is already running, only a browser tab opens: a
  second launch never starts a second server.
- **Stop**: the power button in the top bar (`POST /api/shutdown`). Closing the tab does
  **not** stop the server.
- **By hand**: `python3 launcher.py` (macOS/Linux) or `pythonw launcher.py` (Windows), or
  run `server.py` directly.

## Data

- `data/organizer.json`: the whole document `{"activities":[], "series":[], "todos":[]}`.
  It is created empty on the first start. Every change in the UI is saved at once
  (`PUT /api/data`), with an atomic write (temp file, then `os.replace`).
- `data/backup/organizer-YYYY-MM-DD.json`: before the first save of each day the current
  file is copied here (the state at the start of that day). The last 30 copies are kept.
- Both are in `.gitignore`: your schedule never goes into git. The backups sit on the same
  disk, so they protect against mistakes, not against a dead disk: copy `data/` elsewhere
  if you need that.
- Recurring series store weekdays as JavaScript numbers (0 = Sunday ... 6 = Saturday) and
  per-occurrence changes in `exceptions`, keyed by the **original** date. Shortening
  `until` hides later exceptions without deleting them.
- Activities and series have an optional `color`: a palette key (`grey`, `cyan`, `blue`,
  `indigo`, `lilac`, `purple`, `magenta`), not a hex value; the colours are the `--c-<key>`
  tokens in `static/style.css`. Missing or unknown means the default: `grey` for
  activities (no colour: the block takes the status colour), `lilac` for series. The
  default is saved as no field. A series colour applies to all its occurrences. Coloured
  blocks keep their colour and show the status as a small square in the top-right corner.
- To-dos have an optional `topic` (string); `title` is the task. Empty or missing means
  **Generic** and is saved as no field, so older data needs no migration. Dropping a to-do
  on the grid adds a non-Generic topic to the new activity's tags (no duplicates);
  Reschedule uses the activity's tag as topic when it has exactly one, else Generic.
- Fields the UI does not know about are kept on save.

## Platform notes

- **Windows**: `.py`/`.pyw` files are often not associated with any program, so the
  shortcut runs `wscript launcher.vbs`, which calls `pythonw` explicitly. It uses the
  path in `launcher.local.txt` if that file exists (git-ignored, one line, see
  `launcher.local.txt.example`), otherwise `pythonw.exe` or `pyw.exe` found on PATH.
- **macOS**: `Organizer.app` is an AppleScript applet built locally by
  `setup/macos-setup.sh`; it records the repo path and the python3 path at build time, so
  re-run the script after moving the repo or changing Python. The app is ad-hoc signed,
  not notarized.
- **Linux**: no app wrapper; run `python3 launcher.py`.

## Tests

- `tests/recurrence-test.html`: tests of `static/recurrence.js`. Open it in a browser and
  look for the `RESULT:` line, or headless, e.g.
  `msedge --headless --disable-gpu --dump-dom file:///.../tests/recurrence-test.html`.
