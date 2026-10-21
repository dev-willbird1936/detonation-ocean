#include <windows.h>

/* Inert test program for the Speakeasy harness: opens no file, key or socket and returns at once. */
int main(void) {
    GetTickCount();
    ExitProcess(0);
    return 0;
}
