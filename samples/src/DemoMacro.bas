Attribute VB_Name = "DemoMacro"
' Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
' Guard: needs DETONATION_SANDBOX=1 and the seeded Documents folder /home/dana/Documents (LibreOffice on Linux).
Sub AutoOpen()
    If Environ("DETONATION_SANDBOX") <> "1" Then Exit Sub
    If Dir("/home/dana/Documents", vbDirectory) = "" Then Exit Sub
    Dim handle As Integer
    handle = FreeFile
    Open "/home/dana/Documents/macro-note.txt" For Output As #handle
    Print #handle, "Written by the Detonation Ocean demo macro budget.docm."
    Close #handle
End Sub
