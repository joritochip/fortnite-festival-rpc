import { watchFile, createReadStream, statSync, existsSync, type Stats } from "fs";
import * as path from "path";
import * as os from "os";
import { debugLog } from "../debug";

export type LineHandler = (line: string) => void | Promise<void>;

const FORTNITE_LOG_PATH = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    "AppData", "Local", "FortniteGame", "Saved", "Logs", "FortniteGame.log"
);
const POLL_INTERVAL_MS = 250;

export default class LogWatcher {
    private readonly handlers: LineHandler[] = [];
    private lastSize: number;
    private buffer = "";
    private started = false;
    private chain: Promise<void> = Promise.resolve();

    constructor(){
        this.lastSize = existsSync(FORTNITE_LOG_PATH) ? statSync(FORTNITE_LOG_PATH).size : 0;

        debugLog(`[LogWatcher] Watching log: ${FORTNITE_LOG_PATH}`);
        if(!existsSync(FORTNITE_LOG_PATH)){
            debugLog("[LogWatcher] Log file doesn't exist yet - waiting for Fortnite to create it...");
        }

        watchFile(FORTNITE_LOG_PATH, { interval: POLL_INTERVAL_MS }, (curr) => this.onChange(curr));
    }

    addLineHandler(handler: LineHandler){
        this.handlers.push(handler);
    }

    private onChange(curr: Stats){
        if(curr.size === 0 && !existsSync(FORTNITE_LOG_PATH)) return;

        if(!this.started){
            this.started = true;
            debugLog("[LogWatcher] Detected log activity, now tailing for new lines.");
        }

        // file shrank => it was recreated, read from the top again
        if(curr.size < this.lastSize){
            this.lastSize = 0;
            this.buffer = "";
        }
        if(curr.size <= this.lastSize) return;

        const readStream = createReadStream(FORTNITE_LOG_PATH, { encoding: "utf-8", start: this.lastSize, end: curr.size });
        this.lastSize = curr.size;

        readStream.on("error", (err) => console.error("[LogWatcher] read error:", err.message));
        readStream.on("data", (chunk) => this.consume(chunk.toString()));
    }

    // Splits buffered text into complete lines
    private consume(chunk: string){
        this.buffer += chunk;

        let newlineIndex: number;
        while((newlineIndex = this.buffer.indexOf("\n")) !== -1){
            const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if(line !== "") this.dispatch(line);
        }
    }

    // queue each handler onto the chain
    private dispatch(line: string){
        for(const handler of this.handlers){
            this.chain = this.chain
                .then(() => handler(line))
                .catch((err) => console.error("[LogWatcher] handler error:", err instanceof Error ? err.message : err));
        }
    }
}
