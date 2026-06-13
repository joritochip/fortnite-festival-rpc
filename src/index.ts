import LogWatcher from "./Modules/LogWatcher";
import PresenceManager from "./Modules/PresenceManager";
import { registerFestivalHandler } from "./Modules/FestivalSession";
import { configExists, loadConfig } from "./config";
import { setupConfig } from "./setup";

if(!configExists()) await setupConfig();

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

console.log("Started! Keep this window open while playing Fortnite Festival.");
