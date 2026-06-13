import LogWatcher from "./LogWatcher";
import PresenceManager from "./PresenceManager";
import { debugLog } from "../debug";
import type Scrobbler from "./Scrobbler.js";

export type Song = {
    _title: string;
    track: Track;
    _noIndex: boolean;
    _activeDate: string;
    lastModified: string;
    _locale: string;
    _templateName: string;
};

type Track = {
	tt: string; // title
	ry: number;  // year
	dn: number;  // song length in seconds
	sib: string; // bass icon
	sid: string; // drums icon
	sig: string;  // guitar icon
	qi: string; // ?
	sn: string;  // id
	ge: string[]; // genres, sometimes undefined?
	mk: string;  // key
	mm: string;  // key type
	ab: string;  // album, sometimes blank
	siv: string; // vocals icon
	su: string; // uuid?
	in: Intensities;
	mt: number; // tempo (?)
	_type: string;
	mu: string;
	an: string;  // artist
	gt: string[];
	ar: string;
	au: string;
	ti: string;
	ld: string;
	jc: string;
};

export type Intensities = {
	bd?: number; // Pro Vocals (Karaoke); 99 = no karaoke chart
	pb?: number; // Pro Bass
	pd?: number; // Pro Drums
	vl?: number; // Vocals
	pg?: number; // Pro Lead
	_type: string;
	gr?: number; // Lead
	ds?: number; // Drums
	ba?: number; // Bass
};

export type FestivalState = {
    song: Song | null,
    instrument: string,
    difficulty: string,
    stage: "" | "playing" | "backstage" | "results" | "intro",
    players: number
};

const SPARK_TRACKS_URL = "https://fortnitecontent-website-prod07.ol.epicgames.com/content/api/pages/fortnite-game/spark-tracks";

const INSTRUMENT_INTENSITY_KEYS: Record<string, keyof Intensities> = {
    "Vocals": "vl",
    "Karaoke": "bd",
    "Lead": "gr",
    "Bass": "ba",
    "Drums": "ds",
    "Pro Lead": "pg",
    "Pro Bass": "pb",
    "Pro Drums": "pd",
	"Pro Drums + Cymbals": "pd"
};

// map EPilgrimTrackType::Track<X> suffix to a display name
function trackTypeToInstrument(raw: string): string {
    const normalized = raw.replace(/[\s_-]/g, "").toLowerCase();
    switch(normalized){
        case "vocals": return "Vocals";
        case "provocal":
        case "provocals":
        case "karaoke": return "Karaoke";
        case "bass": return "Bass";
        case "drums":
        case "drum": return "Drums";
        case "lead":
        case "guitar": return "Lead";
        case "keys":
        case "keyboard": return "Keyboard";

        case "prolead":
        case "plasticguitar": return "Pro Lead";
        case "probass":
        case "plasticbass": return "Pro Bass";
        case "prodrums":
        case "plasticdrums":
        case "plasticdrum": return "Pro Drums";
		case "procymbals": return "Pro Drums + Cymbals";
        case "prokeys":
        case "plastickeys": return "Pro Keyboard";

        default: return raw;
    }
}

export function getInstrumentDifficulty(song: Song, instrument: string): number | null {
    const key = INSTRUMENT_INTENSITY_KEYS[instrument];
    if(!key) return null;

    const value = song.track.in?.[key];
    if(typeof value !== "number" || value < 0 || value > 6) return null;

    return value + 1;
}

function stripTimestamp(line: string): string {
    return line.split("]").slice(2).join("]");
}

const catalog = new Map<string, Song>();

async function loadCatalog(){
    try {
        const res = await fetch(SPARK_TRACKS_URL);
        const data = await res.json();
        for(const entry of Object.values(data)){
            if(typeof entry === "object" && entry !== null && !Array.isArray(entry)){
                const song = entry as Song;
                if(song.track?.sn) catalog.set(song.track.sn.toLowerCase(), song);
            }
        }
        debugLog(`[Festival] Loaded ${catalog.size} songs from spark-tracks.`);
    } catch(err){
        console.error("[Festival] Failed to load spark-tracks catalog:", err instanceof Error ? err.message : err);
    }
}

// tracks the current Festival state and translates log lines into presence data
class FestivalSession {
    private readonly state: FestivalState = {
        song: null,
        instrument: "",
        difficulty: "",
        stage: "",
        players: 0
    };

    constructor(
        private readonly manager: PresenceManager,
        private readonly scrobbler: Scrobbler
    ){}

    async handleLine(line: string){
        const message = stripTimestamp(line);
        this.handleTrackDifficulty(message);
        await this.handleSongData(message);
        await this.handleProVocalsStart(message);
        this.handleSongLoaded(message);
        await this.handleQuickplayState(message);
        await this.handleSongStop(message);
        await this.handlePlayerCount(message);
    }

    private async pushPresence(resetTimestamp: boolean){
        if(resetTimestamp) this.manager.updateTimestamp();
        await this.manager.setFestivalState(this.state);
        this.manager.updateStatus();
    }

    // "Song data set. N gems found for ...EPilgrimTrackType::Track<X>...Difficulty<Y>"
    private async handleSongData(message: string){
        const marker = /LogPilgrimGameEvaluator: \[....\] : Song data set. [0-9]* gems found for /;
        if(!marker.test(message)) return;

		const trackMatch = message.match(/EPilgrimTrackType::Track([A-Za-z]+)/);
		if(!trackMatch) return;

		const instrument = trackTypeToInstrument(trackMatch[1]);

        this.state.instrument = instrument;
        this.state.stage = "playing";

        if(this.state.song) this.scrobbler.startSong(this.state.song);

        debugLog(`[Festival] Now playing: instrument="${this.state.instrument}", difficulty="${this.state.difficulty}", song="${this.state.song?.track.tt ?? "(not resolved)"}"`);

        await this.pushPresence(true);
    }

    // "LogPilgrimGemBreakListener: ... using track EPilgrimTrackType::Track<X> and Difficulty EPilgrimSongDifficulty::Difficulty<Y>"
    private handleTrackDifficulty(message: string){
        const match = message.match(/LogPilgrimGemBreakListener:.*using track EPilgrimTrackType::Track[A-Za-z]+ and Difficulty EPilgrimSongDifficulty::Difficulty([A-Za-z]+)/);
        if(!match) return;

        this.state.difficulty = match[1];
    }

	// for pro vocals/karaoke
    // "LogPilgrimProVocalEvaluator: Parsed song and found N sections."
    private async handleProVocalsStart(message: string){
        const marker = /^LogPilgrimProVocalEvaluator: Parsed song and found [0-9]+ sections/;
        if(!marker.test(message)) return;

        this.state.instrument = "Karaoke";
        this.state.stage = "playing";

        if(this.state.song) this.scrobbler.startSong(this.state.song);

        debugLog(`[Festival] Now playing: instrument="Karaoke", difficulty="${this.state.difficulty}", song="${this.state.song?.track.tt ?? "(not resolved)"}"`);

        await this.pushPresence(true);
    }

    // "local client finished loading song <id>"
    private handleSongLoaded(message: string){
        const marker = /local client finished loading song /;
        if(!marker.test(message)) return;

        const id = message.split(marker)[1].split(" ")[0].toLowerCase();
        const song = catalog.get(id);
        if(song){
            this.state.song = song;
            debugLog(`[Festival] Loaded song "${song.track.tt}" by ${song.track.an}`);
        } else {
            debugLog(`[Festival] Couldn't find song "${id}" in spark-tracks (catalog has ${catalog.size} songs)`);
        }
    }

    // "LogPilgrimQuickplayStateMachine ... [Entering|Leaving] Pilgrim Quickplay state <state>"
    private async handleQuickplayState(message: string){
        if(!message.startsWith("LogPilgrimQuickplayStateMachine")) return;

        const leaving = message.includes("Leaving ");
        const state = message.split("Pilgrim Quickplay state ")[1];

        debugLog(`[Festival] State change: ${leaving ? "leaving" : "entering"} "${state}"`);

        switch(state){
            case "EPilgrimQuickplayState::Pregame":
                if(leaving){
                    this.state.stage = "";
                } else {
                    this.scrobbler.stopSong();
                    this.state.song = null;
                    this.state.instrument = "";
                    this.state.difficulty = "";
                    this.state.stage = "backstage";
                    this.state.players = 0;
                }
                await this.pushPresence(true);
            break;
            case "EPilgrimQuickplayState::SongResults":
                if(!leaving) this.scrobbler.stopSong();
                this.state.stage = leaving ? "" : "results";
                await this.pushPresence(!leaving);
            break;
            case "EPilgrimQuickplayState::Preintro":
            case "EPilgrimQuickplayState::Intro":
                if(!leaving){
                    this.state.stage = "intro";
                    await this.pushPresence(false);
                }
            break;
        }
    }

    // End of the tutorial (EndPlay) or a song being stopped both end the current song.
    private async handleSongStop(message: string){
        const endPlay = message.includes("UPilgrimFTUEControllerComponent::EndPlay");
        const stopping = /LogPilgrimGame: \[....\] Stopping song/.test(message);
        if(!endPlay && !stopping) return;

        this.state.stage = "";
        this.scrobbler.stopSong();

        if(endPlay){
            this.state.players = 0;
        } else {
            await this.pushPresence(false);
        }
    }

	// player count
    // "LogPilgrimHamSandwichVM: ... CurrentPlayers:[(Player:...)...]"
    private async handlePlayerCount(message: string){
        if(!message.startsWith("LogPilgrimHamSandwichVM:") || !message.includes("CurrentPlayers:[")) return;

        const roster = message.split("CurrentPlayers:[")[1];
        const playerCount = (roster.match(/\(Player:/g) || []).length;

        if(playerCount > 0 && playerCount !== this.state.players){
            debugLog(`[Festival] Band roster updated: ${playerCount} player(s)`);
            this.state.players = playerCount;
            await this.pushPresence(false);
        }
    }
}

export async function registerFestivalHandler(watcher: LogWatcher, manager: PresenceManager){
    loadCatalog();

    const { default: Scrobbler } = await import("./Scrobbler.js");
    const scrobbler = new Scrobbler(manager.config);
    const session = new FestivalSession(manager, scrobbler);

    watcher.addLineHandler((line) => session.handleLine(line));
}
