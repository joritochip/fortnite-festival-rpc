import { Config, saveConfig } from "./config";
import open from "open";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const LASTFM_API_CREATE_URL = "https://www.last.fm/api/account/create";
const LASTFM_AUTH_URL = "https://www.last.fm/api/auth/";

async function askYesNo(prompt: (question: string) => Promise<string>, question: string): Promise<boolean> {
    let answer = "";
    while(answer[0] !== "y" && answer[0] !== "n"){
        answer = (await prompt(question)).trim().toLowerCase();
    }
    return answer[0] === "y";
}

// request a Last.fm auth token to be authorized in the browser
async function fetchLastFmToken(apiKey: string, apiSecret: string): Promise<string> {
    const { LastFMAuth } = await import("lastfm-ts-api");
    const auth = new LastFMAuth(apiKey, apiSecret);
    const res = await auth.getToken();
    return res.token;
}

// exchange an authorized token for a session key
async function fetchLastFmSessionKey(apiKey: string, apiSecret: string, token: string): Promise<string> {
    const { LastFMAuth } = await import("lastfm-ts-api");
    const auth = new LastFMAuth(apiKey, apiSecret);
    const res = await auth.getSession({ token });
    return res.session.key;
}

export async function setupConfig(): Promise<void> {
	const rl = createInterface({ input, output });
	const prompt = (question: string) => rl.question(question);

	console.log("Fortnite Festival RPC, created by joritochip\n");

    console.log("No existing configuration was found.");
	console.log("If this is your first time running Fortnite Festival RPC, thank you for using it!")
    console.log("Follow the prompts below to get started.\n");

    const config: Config = {
        lastfm: {
			scrobbling: false,
			api_key: "",
			api_secret: "",
			session_key: ""
		},
		debug: false,
		startupNotification: true
    };

	try {
		if(await askYesNo(prompt, "Would you like to set up Last.fm scrobbling for Festival? (y/n) ")){
			if (await askYesNo(prompt, "You must create a Last.fm API key. Would you like to open the Last.fm website to create one? (y/n) ")){
				await open(LASTFM_API_CREATE_URL);
			}

			while(true){
				const apiKey = await prompt("LastFM API Key: ");
				const apiSecret = await prompt("LastFM API Secret: ");

				try {
					const token = await fetchLastFmToken(apiKey, apiSecret);
					const authUrl = `${LASTFM_AUTH_URL}?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;

					console.log("Last.fm will open in your browser to authorize access to your account.");
					console.log(`If your browser doesn't open, visit this URL manually:\n${authUrl}`);
					await open(authUrl);

					await prompt("Once you've authorized access on the Last.fm website, press Enter to continue... ");

					const sessionKey = await fetchLastFmSessionKey(apiKey, apiSecret, token);
					config.lastfm = {
						scrobbling: true,
						api_key: apiKey,
						api_secret: apiSecret,
						session_key: sessionKey
					};

					console.log("Your Last.fm credentials have been saved!");
					console.log("Any song you play on Festival with Fortnite Festival RPC running will be scrobbled to your Last.fm account.");

					break;
				} catch (err) {
					if(!(await askYesNo(prompt, "Last.fm authorization failed (was access granted before continuing?). Would you like to try again? (y/n) "))){
						console.log("Skipping Last.fm scrobbling setup.");
						break;
					}
				}
			}
		}
	} finally {
		console.log("\nSetup complete! Fortnite Festival RPC will now run in the background during subsequent launches.");
		console.log("You may see a console window briefly appear when the app starts up, this is normal and can be ignored.");
		console.log("To set Fortnite Festival RPC as a startup program, right-click its icon in the system tray and enable it.\n");
		await prompt("Press Enter to continue... ");

		rl.close();
	}

    saveConfig(config);
}
