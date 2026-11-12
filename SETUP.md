# Setup

**For the human.** Organizer is a local study planner: a small Python server plus a web
page, with all data in a JSON file on your disk. On a Mac, setup means: clone the repo, make
sure `python3` works (the Xcode Command Line Tools provide it), run
`bash setup/macos-setup.sh`, and you get `Organizer.app` in `~/Applications` plus a link on
the Desktop. Double-click it to start; the power button in the page stops it. Nothing is
downloaded or installed beyond the Command Line Tools, and only if you agree.

**For Claude Code.** The steps below are written for you to execute on a Mac with Apple
Silicon (M1 or later). Rules:

- **Ask the user before installing anything** (Command Line Tools, Homebrew, any package)
  and before any step that opens a system dialog. The app needs no third-party packages:
  do not `pip install` anything.
- Run the commands as written, check each expected result, and stop and report to the user
  when a result differs.
- Never delete or overwrite `data/organizer.json` or `data/backup/`: after the first run
  they hold the user's real schedule.

---

## 1. Check the Command Line Tools (python3 and git)

On a fresh Mac, `/usr/bin/python3` and `/usr/bin/git` are only **stubs**: the first time
they run, macOS opens a dialog offering to install the Xcode Command Line Tools (about
1-2 GB). So check before calling either one:

```bash
xcode-select -p
```

- Prints a path (e.g. `/Library/Developer/CommandLineTools`): the tools are there. Go on.
- Fails ("unable to get active developer directory"): the tools are missing. **Ask the
  user** whether to install them. If yes, run `xcode-select --install`; it opens a dialog
  the user must confirm, and the download takes several minutes. Wait until
  `xcode-select -p` succeeds.
  If the user already has another Python 3.9+ (e.g. Homebrew's `/opt/homebrew/bin/python3`)
  they may prefer it; git is still needed for cloning (or they can download the repo as a
  zip).

Then:

```bash
command -v python3 && python3 --version
```

Expected: a path and `Python 3.9` or later (the Command Line Tools ship 3.9.x, which is
enough).

## 2. Clone the repo

Ask the user for the repo URL if you do not have it. Clone into a folder **outside**
`~/Desktop`, `~/Documents`, `~/Downloads` and iCloud Drive: macOS privacy protection
(TCC) asks for permission when an app reads files there, and the server may then fail to
read its data. Suggested location:

```bash
mkdir -p ~/Projects
git clone <repo-url> ~/Projects/organizer
cd ~/Projects/organizer
```

## 3. Build the app

```bash
cd ~/Projects/organizer
bash setup/macos-setup.sh
```

Options: `--python /path/to/python3` to use a specific interpreter (default:
`python3` on PATH), `--no-desktop-link` to skip the link on the Desktop.

Expected output ends with `Done.` and shows:

- `App:    /Users/<user>/Applications/Organizer.app`
- `Link:   /Users/<user>/Desktop/Organizer -> ...` (unless `--no-desktop-link`)

The script uses only tools that ship with macOS (`osacompile`, `sips`, `iconutil`,
`PlistBuddy`, `xattr`, `codesign`, `python3`). It is idempotent: re-running it rebuilds
the app from scratch. **Re-run it whenever the repo folder moves or Python changes**: the
app stores both paths when it is built.

## 4. Verify

Run these from the repo folder. Before starting, make sure nothing listens on 8765:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN || echo "8765 free"
```

Expected: `8765 free`. If something is listed, see Troubleshooting.

**a. Start through the app and ping:**

```bash
open ~/Applications/Organizer.app
sleep 3
curl -s http://127.0.0.1:8765/api/ping
```

Expected: `{"ok": true, "app": "organizer"}`, and a browser tab on
`http://127.0.0.1:8765/` showing an empty weekly grid.

**b. The data file was created:**

```bash
cat data/organizer.json
git check-ignore -v data/organizer.json
```

Expected on a first run: a JSON document with `"activities": []`, `"series": []`,
`"todos": []`; and `git check-ignore` prints the `.gitignore` rule, meaning the data stays
out of git.

**c. A second launch does not start a second server:**

```bash
open ~/Applications/Organizer.app
sleep 3
lsof -nP -iTCP:8765 -sTCP:LISTEN
```

Expected: exactly one listening process (a Python process), and one more browser tab.

**d. Shutdown frees the port:**

```bash
curl -s -X POST http://127.0.0.1:8765/api/shutdown
sleep 1
lsof -nP -iTCP:8765 -sTCP:LISTEN || echo "8765 free"
```

Expected: `{"ok": true}` then `8765 free`.

Tell the user the result of each step.

## 5. Daily use

- **Start**: double-click `Organizer` on the Desktop or in `~/Applications` (it can be
  dragged to the Dock). If it is already running, only a new browser tab opens.
- **Stop**: the power button in the top bar of the page. Closing the tab does not stop the
  server. From a terminal: `curl -s -X POST http://127.0.0.1:8765/api/shutdown`.
- **Without the app**: `python3 launcher.py` from the repo folder does the same thing.

## 6. Where the data lives

- `data/organizer.json` in the repo folder: the whole schedule, saved on every change.
- `data/backup/organizer-YYYY-MM-DD.json`: a copy taken before the first save of each day,
  last 30 kept.
- Both are git-ignored, so `git pull` never touches them and they are never pushed. They
  are not synced anywhere: to move the schedule to another machine, copy
  `data/organizer.json` by hand while the app is stopped.

## 7. Troubleshooting

**Port 8765 busy.** Find who holds it:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
curl -s http://127.0.0.1:8765/api/ping
```

If the ping answers `"app": "organizer"`, Organizer is simply already running: use it, or
stop it with the shutdown command above. If another program holds the port, the app
cannot start (the browser opens on the other program). Ask the user before stopping that
program; or run Organizer by hand on another port, e.g.
`python3 launcher.py --port 8800` (the app itself always uses 8765).

**"Organizer can't be opened" / "unidentified developer" / "damaged".** The app is built
locally and signed ad hoc, not notarized by Apple. A locally built app normally carries no
quarantine flag and opens directly; if macOS still blocks it:

1. Re-run `bash setup/macos-setup.sh` (it clears extended attributes and re-signs).
2. Right-click the app in Finder, choose **Open**, then **Open** in the dialog; or
   System Settings > Privacy & Security > **Open Anyway**.
3. If the repo was copied from another machine or a download, remove the quarantine flag
   (ask the user first): `xattr -dr com.apple.quarantine ~/Applications/Organizer.app`.

**A dialog "Organizer could not start".** It shows the error from Python. Most often the
repo folder was moved or the Python used at build time is gone: re-run the setup script.
To see the error directly: `python3 launcher.py --no-browser` from the repo folder.

**The server runs but no browser opens.** Check with the ping command; if it answers, open
`http://127.0.0.1:8765/` by hand (`open http://127.0.0.1:8765/`). Check that a default
browser is set (System Settings > Desktop & Dock > Default web browser). On a slow first
start the launcher may give up waiting after 5 seconds: launch again.

**Permission prompt about Desktop/Documents/Downloads.** The repo is inside a protected
folder. Allow it, or move the repo to `~/Projects/organizer` and re-run the setup script.

---

## Windows

- **Python**: 3.9 or later, with `pythonw.exe`. `launcher.vbs` finds it in this order: the
  path written in `launcher.local.txt` (optional, git-ignored; copy
  `launcher.local.txt.example` and edit the last line), then `pythonw.exe` on PATH, then
  `pyw.exe` (the py launcher). A file association for `.py`/`.pyw` is **not** needed.
- **Start**: `wscript launcher.vbs` (no console window). It starts the server if needed and
  opens the browser; a second launch only opens a tab.
- **Desktop shortcut** with the app icon, from the repo folder in PowerShell:

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File setup\windows-shortcut.ps1
  ```

  It writes `Organizer.lnk` on the Desktop, running
  `wscript.exe "<repo>\launcher.vbs"` with `static\icon.ico`. Re-run it after moving the
  repo. `-ShortcutPath <file.lnk>` writes it somewhere else.
- **Check the port**: `netstat -ano | findstr 8765`. **Stop**: the power button, or
  `curl -X POST http://127.0.0.1:8765/api/shutdown`.
