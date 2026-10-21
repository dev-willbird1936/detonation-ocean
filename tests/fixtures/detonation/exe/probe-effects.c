#include <windows.h>
#include <string.h>

/* Inert test program for the Wine harness (tests/detonation-wine.test.mjs). Authored for the tests, not a demo sample. It refuses to run
 * unless DETONATION_SANDBOX=1 and the Documents folder exist. Then it sets one Run value, writes one file in Documents and shows a
 * window for 4 s. It opens no socket and loads no networking DLL. */

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_TIMER) {
        PostQuitMessage(0);
        return 0;
    }
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;
        HDC dc = BeginPaint(window, &paint);
        TextOutA(dc, 20, 20, "Inert Wine probe", 16);
        EndPaint(window, &paint);
        return 0;
    }
    return DefWindowProcA(window, message, wparam, lparam);
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show) {
    char flag[8];
    char documents[MAX_PATH];
    char note[MAX_PATH + 32];
    HKEY key;
    DWORD written;
    HANDLE file;
    WNDCLASSA class_info;
    HWND window;
    MSG message;

    if (GetEnvironmentVariableA("DETONATION_SANDBOX", flag, sizeof flag) == 0 || flag[0] != '1') return 2;
    if (GetEnvironmentVariableA("USERPROFILE", documents, sizeof documents) == 0) return 2;
    strncat(documents, "\\Documents", sizeof documents - strlen(documents) - 1);
    if (GetFileAttributesA(documents) == INVALID_FILE_ATTRIBUTES) return 2;

    if (RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, NULL, 0, KEY_SET_VALUE, NULL, &key, NULL) == ERROR_SUCCESS) {
        RegSetValueExA(key, "InertProbe", 0, REG_SZ, (const BYTE *)"C:\\inert-probe.exe", 19);
        RegCloseKey(key);
    }
    strcpy(note, documents);
    strncat(note, "\\inert-probe.txt", sizeof note - strlen(note) - 1);
    file = CreateFileA(note, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file != INVALID_HANDLE_VALUE) {
        WriteFile(file, "inert probe\r\n", 13, &written, NULL);
        CloseHandle(file);
    }

    memset(&class_info, 0, sizeof class_info);
    class_info.lpfnWndProc = window_proc;
    class_info.hInstance = instance;
    class_info.lpszClassName = "InertProbe";
    class_info.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassA(&class_info);
    window = CreateWindowA("InertProbe", "Inert Wine probe", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 480, 160, NULL, NULL, instance, NULL);
    if (window == NULL) return 3;
    SetTimer(window, 1, 4000, NULL);
    while (GetMessageA(&message, NULL, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageA(&message);
    }
    return 0;
}
