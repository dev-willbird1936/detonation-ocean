; Inert Inno Setup script for the unwrap tests (tests/detonation-unwrap.test.mjs). Authored for the tests: it packs the committed inert.exe
; (inert.c) and lists it under [Run]. The installers are only compiled and read by innoextract; they are never run.
; inno-inert-6.3.3.exe: compiled with Inno Setup 6.3.3 (https://github.com/jrsoftware/issrc/releases/tag/is-6_3_3), a version innoextract reads.
; inno-inert-6.7.3.exe: the same script compiled with Inno Setup 6.7.3, the version of deploy/detonation/Dockerfile.builder, which no
; innoextract release or its git master (up to 6.3.3) reads; the unwrap test uses it for the "version not supported" path.
; Both were compiled in detonation-ocean/builder-installer with the compiler run under Wine and --network none after installing the compiler.
[Setup]
AppName=Inert Test Setup
AppVersion=1.0
DefaultDirName={autopf}\InertTestSetup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=inno-inert
Uninstallable=no
DisableDirPage=yes
DisableProgramGroupPage=yes

[Files]
Source: "inert.exe"; DestDir: "{app}"

[Run]
Filename: "{app}\inert.exe"; Flags: nowait postinstall skipifsilent
