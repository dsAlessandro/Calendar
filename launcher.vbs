' Organizer launcher for Windows, called by the Desktop shortcut (wscript launcher.vbs).
' It runs launcher.py next to this file with pythonw, so no console window appears.
' pythonw is called explicitly because .py/.pyw may not be associated with any program.
' Which pythonw, in this order:
'   1. the path written in launcher.local.txt next to this file (untracked, optional,
'      see launcher.local.txt.example);
'   2. pythonw.exe on PATH;
'   3. pyw.exe (the py launcher) on PATH.
' Any arguments are passed on to launcher.py (--port, --data, --no-browser).
Option Explicit

Dim fso, sh, here, launcher, py, args, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(here, "launcher.py")

py = LocalPython()
If py = "" Then py = FindOnPath("pythonw.exe")
If py = "" Then py = FindOnPath("pyw.exe")
If py = "" Then
  MsgBox "No pythonw.exe found." & vbCrLf & vbCrLf & _
    "Install Python 3.9 or later, or write the full path of pythonw.exe in" & vbCrLf & _
    fso.BuildPath(here, "launcher.local.txt"), vbExclamation, "Organizer"
  WScript.Quit 1
End If

args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " " & Quote(WScript.Arguments(i))
Next
sh.Run Quote(py) & " " & Quote(launcher) & args, 0, False

Function Quote(s)
  Quote = Chr(34) & s & Chr(34)
End Function

' First non-empty, non-comment line of launcher.local.txt, with %VARS% expanded.
' If that file does not exist, or names a missing file, the PATH search is used.
Function LocalPython()
  Dim cfg, f, line
  LocalPython = ""
  cfg = fso.BuildPath(here, "launcher.local.txt")
  If Not fso.FileExists(cfg) Then Exit Function
  Set f = fso.OpenTextFile(cfg, 1)
  Do Until f.AtEndOfStream
    line = Trim(f.ReadLine)
    If line <> "" And Left(line, 1) <> "#" Then
      line = sh.ExpandEnvironmentStrings(line)
      If fso.FileExists(line) Then LocalPython = line
      Exit Do
    End If
  Loop
  f.Close
End Function

' Full path of name in the first PATH folder that has it. WindowsApps is skipped:
' its python entries can be Microsoft Store stubs, not a real interpreter.
Function FindOnPath(name)
  Dim d, p
  FindOnPath = ""
  For Each d In Split(sh.ExpandEnvironmentStrings("%PATH%"), ";")
    d = Trim(d)
    If d <> "" And InStr(1, d, "\WindowsApps", vbTextCompare) = 0 Then
      p = fso.BuildPath(d, name)
      If fso.FileExists(p) Then
        FindOnPath = p
        Exit Function
      End If
    End If
  Next
End Function
