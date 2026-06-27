/*
 * wallpaper-host.exe — tiny native helper for ACTIG's live 3D wallpaper (requirement 17).
 *
 * Windows hides a "WorkerW" window between the desktop icons and the wallpaper. Sending
 * Progman the undocumented 0x052C message spawns one; we then SetParent ACTIG's wallpaper
 * window under that WorkerW so the 3D scene renders as the desktop background. We also
 * read/restore the user's original wallpaper so nothing is lost.
 *
 * Usage:
 *   wallpaper-host.exe attach <HWND>     reparent the given window behind the icons
 *   wallpaper-host.exe detach            re-trigger desktop repaint (drops our window)
 *   wallpaper-host.exe current           print the current wallpaper path
 *   wallpaper-host.exe restore <path>    set the wallpaper back to <path>
 *
 * Build: cl wallpaper-host.c user32.lib  (or see build-native.ps1)
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

static HWND g_workerw = NULL;

static BOOL CALLBACK find_workerw(HWND top, LPARAM lparam) {
    HWND shell = FindWindowEx(top, NULL, "SHELLDLL_DefView", NULL);
    if (shell != NULL) {
        g_workerw = FindWindowEx(NULL, top, "WorkerW", NULL);
    }
    return TRUE;
}

static HWND spawn_workerw(void) {
    HWND progman = FindWindow("Progman", NULL);
    /* Ask Progman to create the WorkerW that sits behind the icons. */
    SendMessageTimeout(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, NULL);
    EnumWindows(find_workerw, 0);
    return g_workerw;
}

int main(int argc, char **argv) {
    if (argc < 2) { printf("usage: wallpaper-host <attach|detach|current|restore> [arg]\n"); return 1; }

    if (strcmp(argv[1], "attach") == 0 && argc >= 3) {
        HWND target = (HWND)(uintptr_t)_strtoui64(argv[2], NULL, 10);
        HWND workerw = spawn_workerw();
        if (workerw && target) { SetParent(target, workerw); return 0; }
        return 2;
    }
    if (strcmp(argv[1], "detach") == 0) {
        /* Force the desktop to repaint, dropping the reparented window. */
        HWND progman = FindWindow("Progman", NULL);
        SendMessageTimeout(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, NULL);
        return 0;
    }
    if (strcmp(argv[1], "current") == 0) {
        char path[MAX_PATH] = {0};
        SystemParametersInfoA(SPI_GETDESKWALLPAPER, MAX_PATH, path, 0);
        printf("%s", path);
        return 0;
    }
    if (strcmp(argv[1], "restore") == 0 && argc >= 3) {
        SystemParametersInfoA(SPI_SETDESKWALLPAPER, 0, argv[2], SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        return 0;
    }
    return 1;
}
