#!/bin/sh
# Builds the Wine prefix of detonation-ocean/wine at image build time (docs/SPEC.md 6.6 "Setup"). Usage: wine_prefix.sh <prefix dir>
# Wine's own DLLs only: no winetricks, no Microsoft redistributables. Run as the sandbox user (uid 10001) so the prefix needs no chown.
#
# C:\Users\Dana\{Documents,Downloads,Desktop,Pictures} are symlinks to /home/dana/<folder>, which at run time is the job's seeded home
# volume. The honey files the seed holds are linked where Windows software looks for them. The links dangle until the volume is mounted.
set -eu

prefix="$1"
home=/home/dana
export WINEPREFIX="$prefix" WINEARCH=wow64 WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml=,winemenubuilder.exe=d" DISPLAY=:99

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
xvfb=$!
sleep 3
wine wineboot --init
# The WINEDEBUG=+relay log of a run lists only these calls (wine_run.py reads who made them): a program's lookup of the Wine registry key
# or of a wine_* export. Without this list +relay would log every API call.
wine reg add 'HKCU\Software\Wine\Debug' /v RelayInclude /f /d 'advapi32.RegOpenKeyExA;advapi32.RegOpenKeyExW;advapi32.RegOpenKeyA;advapi32.RegOpenKeyW;kernelbase.RegOpenKeyExA;kernelbase.RegOpenKeyExW;KERNEL32.GetProcAddress;kernelbase.GetProcAddress;ntdll.LdrGetProcedureAddress'
wineserver -w
wineserver -k || true
kill "$xvfb" 2>/dev/null || true

# Wine copies its builtin DLLs into the prefix (1.4 GB). A file identical to an installed one becomes a symlink to it, so the prefix that
# each job copies to a tmpfs is a few MB. A DLL a program drops over a link replaces the link, not the installed file (the image is read-only).
wine_dirs="/opt/wine-stable/lib/wine/x86_64-windows /opt/wine-stable/lib/wine/i386-windows /opt/wine-stable/share/wine/nls /opt/wine-stable/share/wine/fonts"
find "$prefix/drive_c" -type f -size +16k | while read -r file; do
  for dir in $wine_dirs; do
    installed="$dir/${file##*/}"
    if [ -f "$installed" ] && cmp -s "$file" "$installed"; then ln -sf "$installed" "$file"; break; fi
  done
done

profile="$prefix/drive_c/users/dana"
mkdir -p "$profile"
for folder in Documents Downloads Desktop Pictures; do
  rm -rf "${profile:?}/$folder"
  ln -s "$home/$folder" "$profile/$folder"
done

appdata="$profile/AppData"
mkdir -p "$appdata/Roaming/Microsoft/Credentials" "$appdata/Local/Google/Chrome/User Data" "$appdata/Roaming/Electrum"
ln -sfn "$home/.aws/credentials" "$appdata/Roaming/Microsoft/Credentials/DanaCredentials"
ln -sfn "$home/.config/chromium/Default" "$appdata/Local/Google/Chrome/User Data/Default"
ln -sfn "$home/.electrum/wallets" "$appdata/Roaming/Electrum/wallets"
ln -sfn "$home/.aws" "$profile/.aws"
ln -sfn "$home/.ssh" "$profile/.ssh"
