# Test sample: Abyss depth via the `persistence` finding. Writes a desktop autostart entry that would relaunch this script
# at login. Harmless: it touches only the sandbox's seeded home folder and opens no connection.
import os
import sys

autostart = os.path.expanduser("~/.config/autostart")
os.makedirs(autostart, exist_ok=True)
with open(os.path.join(autostart, "system-updater.desktop"), "w") as entry:
    entry.write("[Desktop Entry]\nType=Application\nName=System Updater\n"
                f"Exec=python3 {os.path.abspath(sys.argv[0])}\nX-GNOME-Autostart-enabled=true\n")
print("Updater installed.")
