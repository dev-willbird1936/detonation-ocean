' Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
' Guard: needs DETONATION_SANDBOX=1 and the seeded Documents folder (/home/dana/Documents, C:\Users\Dana\Documents under Wine).
Option Explicit
Dim shell, fso, documents, note
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
documents = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents"
If shell.ExpandEnvironmentStrings("%DETONATION_SANDBOX%") <> "1" Or Not fso.FolderExists(documents) Then WScript.Quit 0

Set note = fso.CreateTextFile(documents & "\hello-vbs.txt", True)
note.WriteLine "hello from hello.vbs"
note.Close
