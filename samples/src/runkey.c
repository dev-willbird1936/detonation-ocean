/* Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
 * Guard: needs DETONATION_SANDBOX=1 and the seeded Documents folder (/home/dana/Documents, C:\Users\Dana\Documents under Wine).
 * Writes the HKCU Run value "DemoSample", writes Documents\demo-note.txt, shows a window for about 5 s, then exits. (SPEC AT-22)
 */
#include <windows.h>
#include <stdio.h>
#include <string.h>

#define SHOW_MS 5000
#define TIMER_ID 1

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_TIMER:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcA(window, message, wparam, lparam);
}

static int in_sandbox(char *documents, size_t size) {
    char flag[8];
    char profile[MAX_PATH];
    if (GetEnvironmentVariableA("DETONATION_SANDBOX", flag, sizeof flag) == 0 || strcmp(flag, "1") != 0) return 0;
    if (GetEnvironmentVariableA("USERPROFILE", profile, sizeof profile) == 0) return 0;
    snprintf(documents, size, "%s\\Documents", profile);
    DWORD attributes = GetFileAttributesA(documents);
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command_line, int show) {
    char documents[MAX_PATH];
    char self[MAX_PATH];
    char note[MAX_PATH + 32];
    (void)previous;
    (void)command_line;
    if (!in_sandbox(documents, sizeof documents)) return 0;

    GetModuleFileNameA(NULL, self, sizeof self);

    HKEY key;
    if (RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, NULL, 0, KEY_SET_VALUE, NULL, &key, NULL) == ERROR_SUCCESS) {
        RegSetValueExA(key, "DemoSample", 0, REG_SZ, (const BYTE *)self, (DWORD)strlen(self) + 1);
        RegCloseKey(key);
    }

    snprintf(note, sizeof note, "%s\\demo-note.txt", documents);
    HANDLE file = CreateFileA(note, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file != INVALID_HANDLE_VALUE) {
        const char text[] = "Written by the Detonation Ocean demo sample runkey.exe.\r\n";
        DWORD written;
        WriteFile(file, text, sizeof text - 1, &written, NULL);
        CloseHandle(file);
    }

    WNDCLASSA window_class = {0};
    window_class.lpfnWndProc = window_proc;
    window_class.hInstance = instance;
    window_class.hCursor = LoadCursorA(NULL, IDC_ARROW);
    window_class.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    window_class.lpszClassName = "DetonationOceanDemo";
    RegisterClassA(&window_class);

    HWND window = CreateWindowExA(0, window_class.lpszClassName, "Detonation Ocean demo", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                                  200, 150, 480, 200, NULL, NULL, instance, NULL);
    if (window == NULL) return 1;
    CreateWindowExA(0, "STATIC", "Demo sample: wrote a Run key and a note, closing in 5 s.", WS_CHILD | WS_VISIBLE,
                    20, 60, 420, 30, window, NULL, instance, NULL);
    ShowWindow(window, show);
    UpdateWindow(window);
    SetTimer(window, TIMER_ID, SHOW_MS, NULL);

    MSG message;
    while (GetMessageA(&message, NULL, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageA(&message);
    }
    return 0;
}
