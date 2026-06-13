import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Config {
    lastfm: {
        scrobbling: boolean;
        api_key: string;
        api_secret: string;
        session_key: string;
    };
	debug: boolean;
	startupNotification?: boolean;
}

// stored in the app data directory 
export const configDir = path.join(process.env.APPDATA ?? os.homedir(), "fortnite-festival-rpc");
export const configPath = path.join(configDir, "config.json");

export function configExists(): boolean {
    return fs.existsSync(configPath);
}

export function loadConfig(): Config {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as Config;
}

export function saveConfig(config: Config): void {
    if(!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
}
