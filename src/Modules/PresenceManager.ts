import { FestivalState, getInstrumentDifficulty } from "./FestivalSession";
import { Client as DiscordRPCClient, type SetActivity } from "@xhayper/discord-rpc";
import { Config } from "../config";
import { debugLog } from "../debug";

const DISCORD_CLIENT_ID = "1307822425261609093";
const DEFAULT_LARGE_IMAGE = "festlogo";
const PARTY_MAX = 4;

const INSTRUMENT_ICONS: Record<string, string> = {
	"Vocals": "vocals",
	"Karaoke": "provocals",
	"Lead": "lead",
	"Bass": "bass",
	"Drums": "drums",
	"Pro Lead": "prolead",
	"Pro Bass": "probass",
	"Pro Drums": "prodrums",
	"Pro Drums + Cymbals": "procymbals"
};

// show keytar icon for keyboard instruments
function resolveInstrumentIcon(state: FestivalState): string | undefined {
    let icon = INSTRUMENT_ICONS[state.instrument];
    if(!icon) return undefined;

    const track = state.song?.track;
    if(track?.sib === "Keyboard" && icon.includes("bass")) icon = icon.startsWith("pro") ? "prokeytar" : "keytar";
    if(track?.sig === "Keyboard" && icon.includes("lead")) icon = icon.startsWith("pro") ? "prokeytar" : "keytar";
    if(track?.siv === "Keyboard" && icon.includes("vocals")) icon = "keytar";
    return icon;
}

function buildInstrumentLabel(state: FestivalState): string {
    const parts: string[] = [];
    if(state.difficulty) parts.push(state.difficulty);
    if(state.song && state.instrument){
        const intensity = getInstrumentDifficulty(state.song, state.instrument);
        if(intensity !== null) parts.push(`${intensity}/7`);
    }
    return parts.length ? `${state.instrument} (${parts.join(", ")})` : state.instrument;
}

export default class PresenceManager {
    festivalState: FestivalState | null;
    rpcClient: DiscordRPCClient | null;
    timestamp: number;
    config: Config;
    private connectPromise: Promise<void> | null;

    constructor(config: Config) {
        this.festivalState = null;
        this.rpcClient = null;
        this.timestamp = Date.now();
        this.config = config;
        this.connectPromise = null;
    }

    private ensureConnected(): Promise<void> {
        if(this.rpcClient) return Promise.resolve();
        return this.connectPromise ??= (async () => {
            try {
                const client = new DiscordRPCClient({clientId: DISCORD_CLIENT_ID, transport: {type: "ipc"}});
                await client.login();
                this.rpcClient = client;
                debugLog(`[RPC] Connected to Discord (user: ${client.user?.username ?? "unknown"}).`);
            } catch(err){
                console.error("[RPC] Couldn't connect to Discord (is Discord running?):", err instanceof Error ? err.message : err);
            } finally {
                this.connectPromise = null;
            }
        })();
    }

    async setFestivalState(state: FestivalState){
        this.festivalState = { ...state };
        await this.ensureConnected();
    }

    updateTimestamp(){
        this.timestamp = Date.now();
    }

    async clearStatus(){
        await this.rpcClient?.user?.clearActivity();
    }

    updateStatus(){
        if(this.rpcClient === null) return;
        const state = this.festivalState;

        try {
            const activity: SetActivity = {
                largeImageText: "Fortnite Festival",
                startTimestamp: this.timestamp,
                largeImageKey: DEFAULT_LARGE_IMAGE,
                partyId: crypto.randomUUID(),
                partySize: Math.min(Math.max(state?.players ?? 0, 1), PARTY_MAX),
                state: "Main Stage",
                partyMax: PARTY_MAX
            };

            switch(state?.stage){
                case "backstage":
                    activity.details = "Choosing a song...";
                break;
                case "intro":
                    activity.details = "Starting a song...";
                break;
                case "playing":
                case "results":
                    this.applySongActivity(activity);
                break;
            }

            debugLog(`[RPC] Setting Festival activity -> stage: "${state?.stage}", details: "${activity.details ?? "(none)"}"`);
            this.rpcClient.user?.setActivity(activity);
        } catch(err){
            console.error("[RPC] Failed to update Discord activity:", err instanceof Error ? err.message : err);
        }
    }

    private applySongActivity(activity: SetActivity){
		if (!this.festivalState) return;
		const state = this.festivalState;

        const track = state.song?.track;
        const title = track?.tt || "Unknown Song";
        const artist = track?.an || "Unknown Artist(s)";

        activity.details = `${title} - ${artist}${state.stage === "results" ? " (Results)" : ""}`;
        activity.largeImageKey = track?.au || DEFAULT_LARGE_IMAGE;
        activity.largeImageText = title;
        activity.smallImageKey = resolveInstrumentIcon(state);
        activity.smallImageText = buildInstrumentLabel(state);
    }
}
