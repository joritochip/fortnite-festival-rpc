import { Config, saveConfig } from "./config";
import open from "open";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const LASTFM_API_CREATE_URL = "https://www.last.fm/api/account/create";

async function askYesNo(prompt: (question: string) => Promise<string>, question: string): Promise<boolean> {
    let answer = "";
    while(answer[0] !== "y" && answer[0] !== "n"){
        answer = (await prompt(question)).trim().toLowerCase();
    }
    return answer[0] === "y";
}

// get Last.fm session key
async function fetchLastFmSessionKey(apiKey: string, apiSecret: string, username: string, password: string): Promise<string> {
    const { LastFMAuth } = await import("lastfm-ts-api");
    const auth = new LastFMAuth(apiKey, apiSecret);
    const res = await auth.getMobileSession({ username, password });
    return res.session.key;
}

export async function setupConfig(): Promise<void> {
	const rl = createInterface({ input, output });
	const prompt = (question: string) => rl.question(question);

    console.log("No existing configuration was found.");
	console.log("If this is your first time running Fortnite Festival RPC, thank you for using it!")
    console.log("Follow the prompts below to get started.");

    const config: Config = {
        lastfm: {
			scrobbling: false,
			api_key: "",
			api_secret: "",
			session_key: ""
		},
		debug: false
    };

	try {
		if(await askYesNo(prompt, "Would you like to set up Last.fm scrobbling for Festival? (y/n) ")){
			if (await askYesNo(prompt, "You must create a Last.fm API key. Would you like to open the Last.fm website to create one? (y/n) ")){
				await open(LASTFM_API_CREATE_URL);
			}

			while(true){
				const apiKey = await prompt("LastFM API Key: ");
				const apiSecret = await prompt("LastFM API Secret: ");

				console.log("Your username and password are not stored, and are used only once to generate a session key for API requests.");
				const username = await prompt("LastFM Username: ");
				const password = await prompt("LastFM Password: ");

				try {
					const sessionKey = await fetchLastFmSessionKey(apiKey, apiSecret, username, password);
					config.lastfm = {
						scrobbling: true,
						api_key: apiKey,
						api_secret: apiSecret,
						session_key: sessionKey
					};

					console.log("Your Last.fm credentials have been saved!");
					console.log("Any song you play on Festival with Fortnite Festival RPC running will be scrobbled to your LastFM account.\n");

					break;
				} catch (err) {
					if(!(await askYesNo(prompt, "Your Last.fm information appears to be incorrect. Would you like to try again? (y/n) "))){
						console.log("Skipping Last.fm scrobbling setup.\n");
						break;
					}
				}
			}
		}
	} finally {
		rl.close();
	}

    saveConfig(config);
}
