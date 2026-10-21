/* Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
 * Guard: needs DETONATION_SANDBOX=1 and the seeded Documents folder (/home/dana/Documents, C:\Users\Dana\Documents under Wine).
 * Stub-only API: PssCaptureSnapshot in kernel32.dll (process snapshots, Windows 8.1 and later).
 * None of Wine 8.0's builtin DLLs exports it (static export-table scan), so the import cannot be resolved and Wine stops the process
 * at once with a loader error or an "unimplemented function" abort instead of running the guard.
 * Expected: Wine cannot run it within 2 s and the chain moves on to Speakeasy. On real Windows it takes one snapshot and exits. (SPEC AT-23)
 */
#include <windows.h>
#include <processsnapshot.h>
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
    HPSS snapshot = NULL;
    if (PssCaptureSnapshot(GetCurrentProcess(), PSS_CAPTURE_NONE, 0, &snapshot) != ERROR_SUCCESS) return 1;
    PssFreeSnapshot(GetCurrentProcess(), snapshot);
    return 0;
}
