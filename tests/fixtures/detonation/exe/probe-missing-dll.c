#include <windows.h>

/* Inert test program for the Wine harness (tests/detonation-wine.test.mjs): it imports one function from a DLL that exists nowhere, so Wine
 * stops at load time with "err:module:import_dll ... not found" within 2 s. The import library comes from probe-missing-dll.def. The body never
 * runs under Wine and does nothing on any system (it only calls the missing function). */
__declspec(dllimport) int missing_probe_function(void);

int main(void) {
    return missing_probe_function();
}
