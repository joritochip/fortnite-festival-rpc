import { Config } from '../config.js';
import { debugLog, debugWarn } from '../debug.js';
import { LastFMTrack, LastFMTrackScrobbleParams, LastFMTrackUpdateNowPlayingParams } from 'lastfm-ts-api';
import { Song } from './FestivalSession.js';

const MIN_SCROBBLE_SECONDS = 30;
const MAX_HALF_TRACK_SCROBBLE_SECONDS = 4 * 60;

export default class Scrobbler {
    private readonly track: LastFMTrack | null;
    private trackStart = 0;
    private minSeconds = 0;
    private nowPlaying: LastFMTrackUpdateNowPlayingParams | undefined;

    constructor(config: Config) {
        this.track = config.lastfm.scrobbling
            ? new LastFMTrack(config.lastfm.api_key, config.lastfm.api_secret, config.lastfm.session_key)
            : null;
    }

    startSong(song: Song) {
        if (!this.track) return;

        if(this.nowPlaying) this.stopSong();
        this.trackStart = Date.now();

        // last.fm scrobbles after 4 minutes or half the track (whichever is first) w/ 30 second minimum
        this.minSeconds = Math.max(MIN_SCROBBLE_SECONDS, Math.min(Math.floor(song.track.dn / 2), MAX_HALF_TRACK_SCROBBLE_SECONDS));
        this.nowPlaying = {
            track: song.track.tt,
            artist: song.track.an,
            album: song.track.ab || undefined,
            duration: song.track.dn
        };
        this.track.updateNowPlaying(this.nowPlaying).then(() => {
            debugLog(`[Last.fm] Now playing "${this.nowPlaying?.track}" by ${this.nowPlaying?.artist}`);
        }).catch(error => {
            console.error("Error updating now playing:", error);
        });
    }

    stopSong() {
		if (!this.track) return;

        if (this.trackStart === 0) {
            debugLog("[Last.fm] No active track to scrobble");
            return; // program was probably started before the song ended
        }
        if (!this.nowPlaying) {
            this.resetScrobbleState();
            return;
        }

        const playedSeconds = Math.floor((Date.now() - this.trackStart) / 1000);
        const nowPlaying = this.nowPlaying;
        const minSeconds = this.minSeconds;
        const timestamp = Math.floor(this.trackStart / 1000);
        this.resetScrobbleState();

        if (playedSeconds < minSeconds) {
            debugLog(`[Last.fm] Skipped scrobble for "${nowPlaying.track}" (${playedSeconds}s played, ${minSeconds}s required)`);
            return;
        }

        const scrobble: LastFMTrackScrobbleParams = { timestamp, ...nowPlaying };
        this.track.scrobble(scrobble).then(response => {
            const scrobbles = response.scrobbles;
            const accepted = Number(scrobbles['@attr'].accepted);
            const ignored = Number(scrobbles['@attr'].ignored);
            if(accepted > 0){
                debugLog(`[Last.fm] Scrobbled "${nowPlaying.track}" by ${nowPlaying.artist}`);
            } else {
                debugWarn(`[Last.fm] Scrobble ignored for "${nowPlaying.track}" by ${nowPlaying.artist} (${ignored} ignored)`);
            }
        }).catch(error => {
            console.error("Error scrobbling track:", error);
        });
    }

    private resetScrobbleState() {
        this.trackStart = 0;
        this.minSeconds = 0;
        this.nowPlaying = undefined;
    }
}
