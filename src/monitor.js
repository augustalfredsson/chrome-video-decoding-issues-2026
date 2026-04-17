// Per-stream monitoring + global stall detection.
//
// A stall is defined as readyState < HAVE_FUTURE_DATA (3) for more than
// STALL_THRESHOLD_MS. The global stall counter increments when >= 2 streams
// are stalled simultaneously — this is the condition the Chrome bug
// summary highlights as the deadlock signal.

const STALL_THRESHOLD_MS = 500;
const STALL_COINCIDENCE_COUNT = 2;

export class StreamMonitor {
    constructor() {
        this.streams = new Map(); // id -> state
        this.sessionStartMs = performance.now();
        this.firstStallMs = null;
        this.globalStallEvents = []; // { startMs, endMs|null, streamIds[] }
        this.currentGlobalStall = null;
        this.listeners = new Set();
    }

    addListener(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit(event) {
        for (const fn of this.listeners) fn(event);
    }

    registerStream(id, video) {
        const state = {
            id,
            video,
            readyState: video.readyState,
            readyStateHistory: [],
            currentlyStalled: false,
            stallStartCandidate: null,
            stallCount: 0,
            events: [],
            // Presented-frame tracking via requestVideoFrameCallback. This is
            // the decoder-truth metric for our setup because the video element
            // is hidden — `droppedVideoFrames` from getVideoPlaybackQuality()
            // stays at 0 since nothing is being composited.
            presentedFrames: 0,
            firstFrameMediaTime: null,
            lastFrameMediaTime: null,
            firstFrameWallMs: null,
            lastFrameWallMs: null,
            estimatedFps: 0,
            rvfcSupported: typeof video.requestVideoFrameCallback === "function",
        };
        this.streams.set(id, state);

        if (state.rvfcSupported) {
            const onFrame = (_now, metadata) => {
                state.presentedFrames++;
                const wallNow = performance.now();
                if (state.firstFrameMediaTime === null) {
                    state.firstFrameMediaTime = metadata.mediaTime;
                    state.firstFrameWallMs = wallNow;
                } else if (state.lastFrameMediaTime !== null) {
                    const dt = metadata.mediaTime - state.lastFrameMediaTime;
                    if (dt > 0 && dt < 1) {
                        // Exponential smoothing; ignore loop wraps (dt > 1 s).
                        const instFps = 1 / dt;
                        state.estimatedFps = state.estimatedFps === 0
                            ? instFps
                            : state.estimatedFps * 0.9 + instFps * 0.1;
                    }
                }
                state.lastFrameMediaTime = metadata.mediaTime;
                state.lastFrameWallMs = wallNow;
                video.requestVideoFrameCallback(onFrame);
            };
            video.requestVideoFrameCallback(onFrame);
        }

        const pushEvent = (type) => {
            const t = performance.now() - this.sessionStartMs;
            state.events.push({ t, type });
            if (state.events.length > 500) state.events.shift();
            this.emit({ kind: "mediaEvent", id, t, type });
        };

        video.addEventListener("waiting", () => pushEvent("waiting"));
        video.addEventListener("playing", () => pushEvent("playing"));
        video.addEventListener("stalled", () => pushEvent("stalled"));
        video.addEventListener("canplay", () => pushEvent("canplay"));
        video.addEventListener("canplaythrough", () => pushEvent("canplaythrough"));
        video.addEventListener("seeking", () => pushEvent("seeking"));
        video.addEventListener("seeked", () => pushEvent("seeked"));
        video.addEventListener("error", () => pushEvent("error"));
    }

    sampleReadyState(now) {
        for (const state of this.streams.values()) {
            const rs = state.video.readyState;
            state.readyState = rs;
            state.readyStateHistory.push({ t: now - this.sessionStartMs, readyState: rs });
            // Keep ~10 minutes at ~10 Hz sampling.
            if (state.readyStateHistory.length > 6000) state.readyStateHistory.shift();

            if (rs < 3) {
                if (state.stallStartCandidate === null) {
                    state.stallStartCandidate = now;
                } else if (!state.currentlyStalled && now - state.stallStartCandidate > STALL_THRESHOLD_MS) {
                    state.currentlyStalled = true;
                    state.stallCount++;
                    if (this.firstStallMs === null) {
                        this.firstStallMs = now - this.sessionStartMs;
                    }
                    this.emit({
                        kind: "stallStart",
                        id: state.id,
                        t: now - this.sessionStartMs,
                    });
                }
            } else {
                if (state.currentlyStalled) {
                    this.emit({
                        kind: "stallEnd",
                        id: state.id,
                        t: now - this.sessionStartMs,
                    });
                }
                state.currentlyStalled = false;
                state.stallStartCandidate = null;
            }
        }

        this.updateGlobalStall(now);
    }

    updateGlobalStall(now) {
        const stalled = [...this.streams.values()].filter((s) => s.currentlyStalled);
        const isGlobal = stalled.length >= STALL_COINCIDENCE_COUNT;

        if (isGlobal && this.currentGlobalStall === null) {
            this.currentGlobalStall = {
                startMs: now - this.sessionStartMs,
                endMs: null,
                streamIds: stalled.map((s) => s.id),
            };
            this.globalStallEvents.push(this.currentGlobalStall);
            this.emit({ kind: "globalStallStart", t: this.currentGlobalStall.startMs, streamIds: this.currentGlobalStall.streamIds });
        } else if (!isGlobal && this.currentGlobalStall !== null) {
            this.currentGlobalStall.endMs = now - this.sessionStartMs;
            this.emit({ kind: "globalStallEnd", t: this.currentGlobalStall.endMs });
            this.currentGlobalStall = null;
        }
    }

    getPerStreamSnapshot() {
        const out = [];
        for (const state of this.streams.values()) {
            const video = state.video;
            let quality = null;
            if (typeof video.getVideoPlaybackQuality === "function") {
                quality = video.getVideoPlaybackQuality();
            }
            // Expected presented frames if the decoder were keeping up with
            // wall clock since the first presented frame.
            let expectedFrames = 0;
            let missedFrames = 0;
            if (state.firstFrameWallMs !== null && state.estimatedFps > 0) {
                const elapsedSec = (performance.now() - state.firstFrameWallMs) / 1000;
                expectedFrames = Math.round(elapsedSec * state.estimatedFps * video.playbackRate);
                missedFrames = Math.max(0, expectedFrames - state.presentedFrames);
            }

            out.push({
                id: state.id,
                readyState: state.readyState,
                currentTime: video.currentTime,
                playbackRate: video.playbackRate,
                paused: video.paused,
                droppedVideoFrames: quality?.droppedVideoFrames ?? 0,
                totalVideoFrames: quality?.totalVideoFrames ?? 0,
                presentedFrames: state.presentedFrames,
                expectedFrames,
                missedFrames,
                estimatedFps: state.estimatedFps,
                rvfcSupported: state.rvfcSupported,
                stalled: state.currentlyStalled,
                stallCount: state.stallCount,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
            });
        }
        return out;
    }

    getGlobalSnapshot() {
        const sessionMs = performance.now() - this.sessionStartMs;
        const totalStalls = this.globalStallEvents.length;
        const frequencyPerMin = sessionMs > 0 ? totalStalls / (sessionMs / 60000) : 0;
        return {
            sessionMs,
            firstStallMs: this.firstStallMs,
            totalGlobalStalls: totalStalls,
            globalStallFrequencyPerMin: frequencyPerMin,
            inGlobalStall: this.currentGlobalStall !== null,
        };
    }

    getReadyStateHistory() {
        const result = {};
        for (const [id, state] of this.streams) {
            result[id] = state.readyStateHistory;
        }
        return result;
    }
}
