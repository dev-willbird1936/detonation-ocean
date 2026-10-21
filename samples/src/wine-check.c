/* Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
 * Guard: needs DETONATION_SANDBOX=1 and the seeded Documents folder (/home/dana/Documents, C:\Users\Dana\Documents under Wine).
 * Reads HKCU\Software\Wine, which only exists under Wine, and exits. Expected: the anti-analysis signal. (SPEC AT-24)
 */
#include <windows.h>
#include <string.h>

static int in_sandbox(void) {
    char flag[8];
    char profile[MAX_PATH];
    char documents[MAX_PATH + 16];
    if (GetEnvironmentVariableA("DETONATION_SANDBOX", flag, sizeof flag) == 0 || strcmp(flag, "1") != 0) return 0;
    if (GetEnvironmentVariableA("USERPROFILE", profile, sizeof profile) == 0) return 0;
    strcpy(documents, profile);
    strcat(documents, "\\Documents");
    DWORD attributes = GetFileAttributesA(documents);
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

int main(void) {
    if (!in_sandbox()) return 0;
    HKEY key;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Wine", 0, KEY_READ, &key) != ERROR_SUCCESS) return 0;
    char value[64];
    DWORD size = sizeof value;
    RegQueryValueExA(key, "Version", NULL, NULL, (LPBYTE)value, &size);
    RegCloseKey(key);
    return 0;
}
