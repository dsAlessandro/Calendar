# Creates the Organizer shortcut: wscript.exe "<repo>\launcher.vbs", with static\icon.ico.
# Re-running it overwrites the shortcut. Usage, from any folder:
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup\windows-shortcut.ps1
#   ... -ShortcutPath "D:\somewhere\Organizer.lnk"   (default: Organizer.lnk on the Desktop)
param(
    [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Organizer.lnk')
)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $repo 'launcher.vbs'
$icon = Join-Path $repo 'static\icon.ico'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

foreach ($f in @($vbs, $icon, $wscript)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "Missing file: $f" }
}

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($ShortcutPath)
$lnk.TargetPath = $wscript
$lnk.Arguments = '"' + $vbs + '"'
$lnk.WorkingDirectory = $repo
$lnk.IconLocation = "$icon,0"
$lnk.Description = 'Organizer: local study planner'
$lnk.Save()

Write-Host "Shortcut written: $ShortcutPath"
Write-Host "  runs: $wscript `"$vbs`""
