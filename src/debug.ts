import { configExists, loadConfig } from "./config";

let debugEnabled: boolean | undefined;

function isDebugEnabled(): boolean {
    if(debugEnabled === undefined){
        debugEnabled = configExists() ? loadConfig().debug : false;
    }

    return debugEnabled;
}

export function debugLog(...args: Parameters<typeof console.log>): void {
    if(isDebugEnabled()) console.log(...args);
}

export function debugWarn(...args: Parameters<typeof console.warn>): void {
    if(isDebugEnabled()) console.warn(...args);
}
