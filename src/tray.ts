import { dlopen, FFIType, JSCallback, ptr } from "bun:ffi";
import { spawn, spawnSync } from "node:child_process";
import { debugLog, debugWarn } from "./debug";
import { loadConfig, saveConfig } from "./config";

// handles system tray icon and menu using bun:ffi native bindings

// background mutex key to prevent multiple instances
const BACKGROUND_ENV = "FFRPC_BACKGROUND";

// Win32 constants
const SW_HIDE = 0;
const SW_SHOW = 5;
const NIM_ADD = 0x0;
const NIM_DELETE = 0x2;
const NIF_MESSAGE = 0x1;
const NIF_ICON = 0x2;
const NIF_TIP = 0x4;
const NIF_INFO = 0x10;
const NIIF_INFO = 0x1;
const WM_APP = 0x8000;
const WM_TRAY_CALLBACK = WM_APP + 1;
const WM_DESTROY = 0x0002;
const WM_RBUTTONUP = 0x0205;
const WM_LBUTTONUP = 0x0202;
const WM_CONTEXTMENU = 0x007b;
const MF_STRING = 0x0;
const MF_CHECKED = 0x8;
const MF_UNCHECKED = 0x0;
const TPM_RIGHTBUTTON = 0x0002;
const TPM_RETURNCMD = 0x0100;
const PM_REMOVE = 0x0001;
const IDI_APPLICATION = 32512;
const MB_OK = 0x0;
const MB_ICONINFORMATION = 0x40;
const ID_QUIT = 1;
const ID_TOGGLE_STARTUP = 2;
const ID_TOGGLE_NOTIFICATION = 3;

// start-up app registry key
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "FortniteFestivalRPC";

const PTR = FFIType.ptr;
const U32 = FFIType.u32;
const U64 = FFIType.u64;
const I64 = FFIType.i64;
const I32 = FFIType.i32;

const user32 = dlopen("user32.dll", {
    ShowWindow: { args: [PTR, I32], returns: I32 },
    MessageBoxW: { args: [PTR, PTR, PTR, U32], returns: I32 },
    RegisterClassExW: { args: [PTR], returns: FFIType.u16 },
    CreateWindowExW: { args: [U32, PTR, PTR, U32, I32, I32, I32, I32, PTR, PTR, PTR, PTR], returns: PTR },
    DefWindowProcW: { args: [PTR, U32, U64, I64], returns: I64 },
    LoadIconW: { args: [PTR, PTR], returns: PTR },
    CreatePopupMenu: { args: [], returns: PTR },
    AppendMenuW: { args: [PTR, U32, PTR, PTR], returns: I32 },
    TrackPopupMenu: { args: [PTR, U32, I32, I32, I32, PTR, PTR], returns: I32 },
    DestroyMenu: { args: [PTR], returns: I32 },
    GetCursorPos: { args: [PTR], returns: I32 },
    SetForegroundWindow: { args: [PTR], returns: I32 },
    PostMessageW: { args: [PTR, U32, U64, I64], returns: I32 },
    PostQuitMessage: { args: [I32], returns: FFIType.void },
    PeekMessageW: { args: [PTR, PTR, U32, U32, U32], returns: I32 },
    TranslateMessage: { args: [PTR], returns: I32 },
    DispatchMessageW: { args: [PTR], returns: I64 }
});

const kernel32 = dlopen("kernel32.dll", {
    GetConsoleWindow: { args: [], returns: PTR },
    GetModuleHandleW: { args: [PTR], returns: PTR },
    GetConsoleProcessList: { args: [PTR, U32], returns: U32 },
    FreeConsole: { args: [], returns: I32 },
    CreateMutexW: { args: [PTR, I32, PTR], returns: PTR },
    OpenMutexW: { args: [U32, I32, PTR], returns: PTR }
});

const shell32 = dlopen("shell32.dll", {
    Shell_NotifyIconW: { args: [U32, PTR], returns: I32 },
    ExtractIconW: { args: [PTR, PTR, U32], returns: PTR }
});

// UTF-16LE, null-terminated string buffer for the wide-char Win32 APIs.
function wstr(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str + "\0", "utf16le"));
}

// startup toggle 
function isStartupEnabled(): boolean {
    try {
        const res = spawnSync("reg", ["query", RUN_KEY, "/v", RUN_VALUE], { windowsHide: true });
        return res.status === 0;
    } catch(err){
        debugWarn("[Tray] Failed to read startup entry:", err);
        return false;
    }
}

function setStartupEnabled(enable: boolean): void {
    try {
        const args = enable
            // Wrap the path in quotes so Windows still launches it when it contains spaces.
            ? ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `"${process.execPath}"`, "/f"]
            : ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"];
        spawnSync("reg", args, { windowsHide: true });
    } catch(err){
        debugWarn("[Tray] Failed to update startup entry:", err);
    }
}

// startup notification toggle
function isStartupNotificationEnabled(): boolean {
    try {
        return loadConfig().startupNotification !== false; // missing - default on
    } catch(err){
        debugWarn("[Tray] Failed to read notification preference:", err);
        return true;
    }
}

function setStartupNotificationEnabled(enable: boolean): void {
    try {
        const config = loadConfig();
        config.startupNotification = enable;
        saveConfig(config);
    } catch(err){
        debugWarn("[Tray] Failed to update notification preference:", err);
    }
}

// Module-scope references so buffers/callbacks survive for the process lifetime
// (Win32 keeps pointers to them long after the registering call returns).
let keepAlive: unknown[] = [];
let nidBuffer: Uint8Array | null = null;
let started = false;

// only a console we exclusively own should be hidden
function ownsConsole(): boolean {
    const hConsole = kernel32.symbols.GetConsoleWindow();
    if(!hConsole) return false;

    const list = new Uint32Array(8);
    const count = kernel32.symbols.GetConsoleProcessList(ptr(list), list.length);
    return count <= 1;
}

// re-launch this executable as a detached background process (no inherited console)
export function relaunchInBackground(): boolean {
    if(process.platform !== "win32") return false;
    if(process.env[BACKGROUND_ENV] === "1") return false; // we are the background copy
    if(!ownsConsole()) return false;                       // shared console (eg. dev) - run inline

    try {
        const child = spawn(process.execPath, process.argv.slice(1), {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: { ...process.env, [BACKGROUND_ENV]: "1" }
        });
        child.unref();
        debugLog("[Tray] Relaunched in the background; exiting the console process.");
        return true;
    } catch(err){
        debugWarn("[Tray] Background relaunch failed, continuing inline:", err);
        return false;
    }
}

// single-instance lock, backed by a named Win32 mutex
const MUTEX_NAME = "FortniteFestivalRpc.SingleInstance";
const SYNCHRONIZE = 0x00100000;
let instanceMutex: unknown = null;

// check if another copy of the app is already holding the lock
export function isAnotherInstanceRunning(): boolean {
    if(process.platform !== "win32") return false;
    try {
        const name = wstr(MUTEX_NAME);
        const handle = Number(kernel32.symbols.OpenMutexW(SYNCHRONIZE, 0, ptr(name)));
        return handle !== 0;
    } catch(err){
        debugWarn("[Instance] Failed to check for a running instance:", err);
        return false;
    }
}

export function acquireInstanceLock(): void {
    if(process.platform !== "win32" || instanceMutex) return;
    try {
        const name = wstr(MUTEX_NAME);
        const handle = kernel32.symbols.CreateMutexW(0 as never, 0, ptr(name));
        instanceMutex = handle;
        keepAlive.push(name, handle);
    } catch(err){
        debugWarn("[Instance] Failed to acquire the single-instance lock:", err);
    }
}

export function notifyAlreadyRunning(title: string, message: string): void {
    if(process.platform !== "win32") return;
    try {
        user32.symbols.MessageBoxW(
            0 as never,
            ptr(wstr(message)),
            ptr(wstr(title)),
            MB_OK | MB_ICONINFORMATION
        );
    } catch(err){
        debugWarn("[Instance] Failed to show the already-running notice:", err);
    }
}

// Show the console window so first-time setup prompts are visible
export function showConsoleWindow(): void {
    if(process.platform !== "win32") return;
    try {
        const hConsole = kernel32.symbols.GetConsoleWindow();
        if(!hConsole) return;
        user32.symbols.ShowWindow(hConsole as never, SW_SHOW);
        user32.symbols.SetForegroundWindow(hConsole as never);
    } catch(err){
        debugWarn("[Tray] Failed to show the console window:", err);
    }
}

function loadAppIcon(hInstance: number): number {
    try {
        const exePath = wstr(process.execPath);
        keepAlive.push(exePath);
        const icon = Number(shell32.symbols.ExtractIconW(hInstance, ptr(exePath), 0));
        // ExtractIconW returns NULL (no icon) or 1 (not a valid executable).
        if(icon > 1) return icon;
    } catch { /* fall through to the default application icon */ }
    return Number(user32.symbols.LoadIconW(0 as never, IDI_APPLICATION as never));
}

function showTrayMenu(hWnd: number, quitText: Uint8Array, startupText: Uint8Array, notificationText: Uint8Array, onToggleStartup: () => void, onToggleNotification: () => void, onQuit: () => void){
    const hMenu = user32.symbols.CreatePopupMenu();
    // Reflect the current toggle states with a checkmark each time the menu opens.
    const startupFlags = MF_STRING | (isStartupEnabled() ? MF_CHECKED : MF_UNCHECKED);
    user32.symbols.AppendMenuW(hMenu, startupFlags, ID_TOGGLE_STARTUP as never, ptr(startupText));
    const notificationFlags = MF_STRING | (isStartupNotificationEnabled() ? MF_CHECKED : MF_UNCHECKED);
    user32.symbols.AppendMenuW(hMenu, notificationFlags, ID_TOGGLE_NOTIFICATION as never, ptr(notificationText));
    user32.symbols.AppendMenuW(hMenu, MF_STRING, ID_QUIT as never, ptr(quitText));

    const point = new Int32Array(2);
    user32.symbols.GetCursorPos(ptr(point));

    // Required so the popup menu dismisses correctly when clicking elsewhere.
    user32.symbols.SetForegroundWindow(hWnd as never);
    const cmd = user32.symbols.TrackPopupMenu(
        hMenu, TPM_RIGHTBUTTON | TPM_RETURNCMD, point[0]!, point[1]!, 0, hWnd as never, 0 as never
    );
    user32.symbols.PostMessageW(hWnd as never, 0, 0n, 0n);
    user32.symbols.DestroyMenu(hMenu);

    if(cmd === ID_QUIT) onQuit();
    else if(cmd === ID_TOGGLE_STARTUP) onToggleStartup();
    else if(cmd === ID_TOGGLE_NOTIFICATION) onToggleNotification();
}

export interface TrayOptions {
    tooltip: string;
    alertTitle: string;
    alertMessage: string;
    onQuit: () => void | Promise<void>;
}

export function startTray(options: TrayOptions): boolean {
    if(process.platform !== "win32" || started) return false;

    // if running via command (bun start run) don't move to background
    const isBackgroundCopy = process.env[BACKGROUND_ENV] === "1";
    if(!isBackgroundCopy && !ownsConsole()){
        debugLog("[Tray] Shared console detected - leaving the window visible.");
        return false;
    }

    try {
        const hInstance = Number(kernel32.symbols.GetModuleHandleW(0 as never));

        const showStartupNotification = isStartupNotificationEnabled();

        let requestedQuit = false;
        const quitText = wstr("Quit");
        const startupText = wstr("Run at startup");
        const notificationText = wstr("Show startup notification");
        const toggleStartup = () => setStartupEnabled(!isStartupEnabled());
        const toggleNotification = () => setStartupNotificationEnabled(!isStartupNotificationEnabled());

        const requestQuit = () => {
            if(requestedQuit) return;
            requestedQuit = true;
            if(nidBuffer) shell32.symbols.Shell_NotifyIconW(NIM_DELETE, ptr(nidBuffer));
            Promise.resolve(options.onQuit()).finally(() => process.exit(0));
        };

        // Window procedure: handles tray clicks and window destruction
        const wndProc = new JSCallback(
            (hWnd: number, msg: number, wParam: bigint, lParam: bigint): bigint => {
                try {
                    if(msg === WM_TRAY_CALLBACK){
                        const mouseMsg = Number(lParam & 0xffffn);
                        if(mouseMsg === WM_RBUTTONUP || mouseMsg === WM_LBUTTONUP || mouseMsg === WM_CONTEXTMENU){
                            showTrayMenu(hWnd, quitText, startupText, notificationText, toggleStartup, toggleNotification, requestQuit);
                        }
                        return 0n;
                    }
                    if(msg === WM_DESTROY){
                        user32.symbols.PostQuitMessage(0);
                        return 0n;
                    }
                } catch(err){
                    debugWarn("[Tray] window procedure error:", err);
                }
                return user32.symbols.DefWindowProcW(hWnd as never, msg, wParam, lParam) as bigint;
            },
            { args: [PTR, U32, U64, I64], returns: I64 }
        );

        const className = wstr("FortniteFestivalRpcTray");
        const hIcon = loadAppIcon(hInstance);

        // WNDCLASSEXW (80 bytes on x64)
        const wndClass = new ArrayBuffer(80);
        const wc = new DataView(wndClass);
        wc.setUint32(0, 80, true);                              // cbSize
        wc.setBigUint64(8, BigInt(wndProc.ptr as number), true); // lpfnWndProc
        wc.setBigUint64(24, BigInt(hInstance as number), true);  // hInstance
        wc.setBigUint64(32, BigInt(hIcon as number), true);      // hIcon
        wc.setBigUint64(64, BigInt(ptr(className)), true);       // lpszClassName
        wc.setBigUint64(72, BigInt(hIcon as number), true);      // hIconSm
        const wndClassBuf = new Uint8Array(wndClass);
        user32.symbols.RegisterClassExW(ptr(wndClassBuf));

        // A normal (never-shown) top-level window to receive the tray callbacks.
        const hWnd = Number(user32.symbols.CreateWindowExW(
            0, ptr(className), ptr(wstr("Fortnite Festival RPC")), 0,
            0, 0, 0, 0, 0 as never, 0 as never, hInstance, 0 as never
        ));

        // NOTIFYICONDATAW (976 bytes on x64)
        const nid = new ArrayBuffer(976);
        const nd = new DataView(nid);
        nd.setUint32(0, 976, true);              // cbSize
        nd.setBigUint64(8, BigInt(hWnd), true);  // hWnd
        nd.setUint32(16, 1, true);                        // uID
        // Add NIF_INFO so the icon shows its notification on creation.
        const uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | (showStartupNotification ? NIF_INFO : 0);
        nd.setUint32(20, uFlags, true);                   // uFlags
        nd.setUint32(24, WM_TRAY_CALLBACK, true);         // uCallbackMessage
        nd.setBigUint64(32, BigInt(hIcon as number), true); // hIcon
        const tip = Buffer.from(options.tooltip.slice(0, 127) + "\0", "utf16le"); // szTip
        new Uint8Array(nid, 40, tip.length).set(tip);
        if(showStartupNotification){
            // szInfo (offset 304, 256 wchars) / szInfoTitle (offset 820, 64 wchars).
            const info = Buffer.from(options.alertMessage.slice(0, 255) + "\0", "utf16le");
            new Uint8Array(nid, 304, info.length).set(info);
            const infoTitle = Buffer.from(options.alertTitle.slice(0, 63) + "\0", "utf16le");
            new Uint8Array(nid, 820, infoTitle.length).set(infoTitle);
            nd.setUint32(948, NIIF_INFO, true);           // dwInfoFlags - info icon
        }
        nidBuffer = new Uint8Array(nid);
        shell32.symbols.Shell_NotifyIconW(NIM_ADD, ptr(nidBuffer));

        // hide original console window
        const hConsole = kernel32.symbols.GetConsoleWindow();
        if(hConsole) user32.symbols.ShowWindow(hConsole as never, SW_HIDE);
        kernel32.symbols.FreeConsole();
        console.log = console.error = console.warn = console.info = () => {};

        // keep log watcher running in background
        const msg = new Uint8Array(64);
        const pump = setInterval(() => {
            while(user32.symbols.PeekMessageW(ptr(msg), 0 as never, 0, 0, PM_REMOVE)){
                user32.symbols.TranslateMessage(ptr(msg));
                user32.symbols.DispatchMessageW(ptr(msg));
            }
        }, 16);

        keepAlive.push(wndProc, className, quitText, startupText, notificationText, wndClassBuf, nidBuffer, msg, pump, hWnd);
        started = true;
        debugLog("[Tray] Running in the system tray; console hidden.");
        return true;
    } catch(err){
        console.error("[Tray] Failed to start system tray, keeping the window open:", err instanceof Error ? err.message : err);
        return false;
    }
}
