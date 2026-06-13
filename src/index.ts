import LogWatcher from "./modules/LogWatcher";
import PresenceManager from "./modules/PresenceManager";
import { registerFestivalHandler } from "./modules/FestivalSession";
import { acquireInstanceLock, isAnotherInstanceRunning, notifyAlreadyRunning, relaunchInBackground, showConsoleWindow, startTray } from "./tray";
import { configExists, loadConfig } from "./config";
import { setupConfig } from "./setup";

if(isAnotherInstanceRunning()){
    notifyAlreadyRunning(
        "Fortnite Festival RPC",
        "Fortnite Festival RPC is already running. Look for its icon in the system tray."
    );
    process.exit(0);
}

if(!configExists()){
    showConsoleWindow();
    await setupConfig();
}

if(relaunchInBackground()) process.exit(0);
acquireInstanceLock();

const config = loadConfig();
const watcher = new LogWatcher();
const manager = new PresenceManager(config);

await registerFestivalHandler(watcher, manager);

watcher.addLineHandler(async (line) => {
    if (
		line.includes("LogOnlineGame: FortPC::ClientReturnToMainMenuWithTextReason()") ||
		/Disconnecting: \d+: DevReason - Kicked/.test(line) ||
		line.startsWith("Log file closed")
	){
        await manager.clearStatus();
    }
});

const inTray = startTray({
    tooltip: "Fortnite Festival RPC",
    alertTitle: "Fortnite Festival RPC is active.",
    alertMessage: "You can close it by right-clicking its icon in the system tray.",
    onQuit: async () => {
        await manager.clearStatus();
    }
});

if(!inTray){
    console.log("Started! Keep this window open while playing Fortnite Festival.");
}
