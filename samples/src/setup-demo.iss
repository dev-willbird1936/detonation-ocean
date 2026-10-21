; Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
; Guard: InitializeSetup exits unless DETONATION_SANDBOX=1 and the seeded Documents folder (/home/dana/Documents, C:\Users\Dana\Documents under Wine) exists.
; Wraps runkey.exe, which carries the same guard. Built by tools/build-test-binaries.sh. (SPEC AT-20)
[Setup]
AppName=Detonation Ocean Demo
AppVersion=1.0
DefaultDirName={autopf}\DetonationOceanDemo
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
Uninstallable=no
Compression=lzma2
SolidCompression=yes
OutputDir=.
OutputBaseFilename=setup-demo

[Files]
Source: "runkey.exe"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{app}\runkey.exe"; Flags: nowait

[Code]
function InitializeSetup: Boolean;
begin
  Result := (GetEnv('DETONATION_SANDBOX') = '1') and DirExists(GetEnv('USERPROFILE') + '\Documents');
end;
