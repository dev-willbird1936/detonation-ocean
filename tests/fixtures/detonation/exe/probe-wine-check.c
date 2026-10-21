#include <windows.h>

/* Inert test program for the Wine harness (tests/detonation-wine.test.mjs): the two checks a sandbox-aware program makes for Wine, then it
 * exits. Authored for the tests, not a demo sample. It refuses to run unless DETONATION_SANDBOX=1. It writes nothing and opens no socket. */
int main(void) {
    char flag[8];
    HKEY key;
    FARPROC version;

    if (GetEnvironmentVariableA("DETONATION_SANDBOX", flag, sizeof flag) == 0 || flag[0] != '1') return 2;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Wine", 0, KEY_READ, &key) == ERROR_SUCCESS) RegCloseKey(key);
    version = GetProcAddress(GetModuleHandleA("ntdll.dll"), "wine_get_version");
    return version != NULL ? 0 : 1;
}
