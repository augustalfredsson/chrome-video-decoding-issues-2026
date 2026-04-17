// Sync multiple <video> elements to an external WallClock using a rate
// ladder, latency-compensated jumps, and an await-sync resolve window.

const SYNC_INTERVAL_MS = 50;
const STUCK_SYNC_RESET_MS = 5000;
const PAUSED_SYNC_THRESHOLD_MS = 5;
const USER_SELECTED_PLAYBACK_RATE = 1;
// Minimum consecutive sync ticks with readyState >= HAVE_CURRENT_DATA before a
// seek is allowed. Dumping a new seek on a decoder that hasn't stabilised
// compounds pressure and can leave Chrome refusing to present a frame.
const MIN_CAN_DRAW_TICKS = 2;
// Force-seek after this many ms of waiting, to avoid deadlock if readyState is
// permanently stuck below HAVE_CURRENT_DATA.
const MAX_SEEK_QUEUE_MS = 1000;
// After changing playbackRate, Chrome's reported currentTime briefly freezes
// while the decoder re-negotiates the new pace. Skip sync corrections during
// this window so we don't interpret the freeze as a stall and escalate to a
// jump.
const RATE_RESOLVE_MS = 500;

function rangesToString(ranges) {
    const out = [];
    for (let i = 0; i < ranges.length; i++) {
        out.push(`[${ranges.start(i).toFixed(2)}-${ranges.end(i).toFixed(2)}]`);
    }
    return out.length === 0 ? "(empty)" : out.join(",");
}

// True iff `time` (seconds) falls inside one of the video's buffered ranges.
// Used to avoid seeking to unbuffered regions, where Chrome clamps to the end
// of the buffered range and cancels the in-progress download.
function isBuffered(video, time) {
    const ranges = video.buffered;
    for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= time && time <= ranges.end(i)) return true;
    }
    return false;
}

// Measures the time from a jump decision (registerStart) until the video
// element's currentTime actually moves away from its starting value. Captures
// queue-wait + one sync-tick granularity rather than Chrome's seeked-event
// duration.
//
// - 50/50 weighted average of previous and new measurements.
// - Clamped to [0, 2500] ms.
// - Skip registration if the player is paused.
// - Trackers are cleared on pause.
class JumpLatencyMonitor {
    constructor() {
        this.latencies = {}; // id -> latency (ms)
        this.trackers = {}; // id -> { started, videoPlayerCurrentTime }
    }

    registerStart(id, nowMs, videoPlayerCurrentTime, isPaused) {
        if (isPaused) return;
        this.trackers[id] = { started: nowMs, videoPlayerCurrentTime };
    }

    adjust(id, nowMs, currentVideoElementTime) {
        const tracker = this.trackers[id];
        if (!tracker) return;
        if (tracker.videoPlayerCurrentTime === currentVideoElementTime) return;
        delete this.trackers[id];
        const newLatency = nowMs - tracker.started;
        const previous = this.latencies[id] ?? 0;
        const weighted = previous * 0.5 + newLatency * 0.5;
        this.latencies[id] = Math.max(0, Math.min(2500, weighted));
    }

    getLatencyMs(id) {
        return this.latencies[id] ?? 0;
    }

    clearTrackers() {
        this.trackers = {};
    }
}

export class SyncController {
    constructor(options) {
        this.entries = [];
        this.clock = options?.clock ?? null;
        this.running = false;
        this.rafId = null;
        this.lastTickAt = 0;
        this.onSyncEvent = options?.onSyncEvent ?? (() => {});
        this.enabled = options?.enabled ?? true;
        this.jumpLatencyMonitor = new JumpLatencyMonitor();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            for (const entry of this.entries) {
                if (entry.video.playbackRate !== 1) entry.video.playbackRate = 1;
                entry.awaitingSync = false;
            }
        }
    }

    addVideo(id, video) {
        const entry = {
            id,
            video,
            awaitingSync: false,
            isSeeking: false,
            lastSyncAt: 0,
            canDrawTicks: 0,
            pendingSeekTarget: null,
            pendingSeekQueuedAt: 0,
            // Absolute performance.now() until which a rate change should be
            // treated as "not yet resolved" — diff readings from the video
            // element are unreliable in this window, so we skip corrections.
            awaitRateResolveUntil: 0,
        };

        video.addEventListener("seeking", () => {
            entry.isSeeking = true;
        });
        video.addEventListener("seeked", () => {
            entry.isSeeking = false;
            entry.awaitingSync = false;
        });

        this.entries.push(entry);
    }

    start() {
        if (this.running || this.entries.length === 0) return;
        this.running = true;
        // Play all videos from the user gesture so autoplay rules are satisfied.
        // The sync tick then enforces play/pause based on the clock's state.
        for (const entry of this.entries) {
            entry.video.play().catch((e) => {
                this.onSyncEvent({ type: "playError", id: entry.id, error: String(e) });
            });
        }
        this.tick();
    }

    stop() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        for (const entry of this.entries) entry.video.pause();
    }

    tick = () => {
        if (!this.running) return;
        const now = performance.now();
        if (now - this.lastTickAt >= SYNC_INTERVAL_MS) {
            this.lastTickAt = now;
            this.syncAll(now);
        }
        this.rafId = requestAnimationFrame(this.tick);
    };

    syncAll(now) {
        for (const entry of this.entries) {
            if (entry.video.readyState < 3) {
                this.onSyncEvent({
                    type: "noReadyState",
                    id: entry.id,
                    t: now,
                    readyState: entry.video.readyState,
                });
            }
        }

        if (!this.clock) return;
        const clockRunning = this.clock.isRunning();
        const expectedTime = this.clock.getExpectedSeconds();

        // When paused, any in-flight latency measurement is discarded — a
        // paused timeline gives no signal about decoder speed.
        if (!clockRunning) {
            this.jumpLatencyMonitor.clearTrackers();
        }

        for (const entry of this.entries) {
            const video = entry.video;
            if (!Number.isFinite(video.duration) || video.duration <= 0) continue;

            // Track consecutive ticks with drawable data. Reset on any dip.
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                entry.canDrawTicks++;
            } else {
                entry.canDrawTicks = 0;
            }

            // Per-tick latency adjustment: ends the measurement started at
            // enqueueSeek once the video's currentTime has actually moved.
            this.jumpLatencyMonitor.adjust(entry.id, now, video.currentTime);

            // Enforce playback state to match clock state.
            if (clockRunning && video.paused) {
                video.play().catch((e) => {
                    this.onSyncEvent({ type: "playError", id: entry.id, error: String(e) });
                });
            } else if (!clockRunning && !video.paused) {
                video.pause();
            }

            // Dispatch queued seek when the readyState gate opens.
            if (!entry.isSeeking && entry.pendingSeekTarget !== null) {
                const queuedTooLong = now - entry.pendingSeekQueuedAt > MAX_SEEK_QUEUE_MS;
                if (entry.canDrawTicks >= MIN_CAN_DRAW_TICKS || queuedTooLong) {
                    this.performSeek(entry);
                }
            }

            if (entry.isSeeking) continue;

            if (entry.awaitingSync && now - entry.lastSyncAt > STUCK_SYNC_RESET_MS) {
                entry.awaitingSync = false;
                this.onSyncEvent({ type: "awaitReset", id: entry.id, t: now });
            }
            if (entry.awaitingSync) {
                this.onSyncEvent({ type: "awaitSync", id: entry.id, t: now });
                continue;
            }
            // After a rate change, currentTime reports from the video element
            // are unreliable for a short window. If we act on them we can
            // either misread progress (cancelling a still-catching-up
            // speedUp), or compound stall readings into a premature jump.
            if (now < entry.awaitRateResolveUntil) {
                this.onSyncEvent({ type: "awaitSync", id: entry.id, t: now });
                continue;
            }

            if (clockRunning) {
                this.syncOne(entry, expectedTime, now);
            } else {
                this.syncWhilePaused(entry, expectedTime, now);
            }
            entry.lastSyncAt = now;
        }
    }

    setRate(entry, rate, now) {
        if (entry.video.playbackRate === rate) return;
        entry.video.playbackRate = rate;
        entry.awaitRateResolveUntil = now + RATE_RESOLVE_MS;
    }

    computeDiffMs(video, expectedTime) {
        const duration = video.duration;
        let diff = video.currentTime - expectedTime;
        if (diff > duration / 2) diff -= duration;
        else if (diff < -duration / 2) diff += duration;
        return diff * 1000;
    }

    syncOne(entry, expectedTime, now) {
        const { video } = entry;
        const expectedRate = USER_SELECTED_PLAYBACK_RATE;
        const currentRate = video.playbackRate;
        const hasAdjustedRate = currentRate !== expectedRate;
        const diffMs = this.computeDiffMs(video, expectedTime);

        this.onSyncEvent({
            type: "diff",
            id: entry.id,
            t: now,
            diffMs,
            rate: currentRate,
            readyState: video.readyState,
            jumpLatencyMs: this.jumpLatencyMonitor.getLatencyMs(entry.id),
        });

        if (!this.enabled) return;

        // NOTE: do NOT early-return on readyState here. A stuck decoder can sit
        // below HAVE_FUTURE_DATA indefinitely; the only way out is to enqueue a
        // seek and let the MAX_SEEK_QUEUE_MS escape hatch dispatch it once the
        // wait has passed. Gating the diff check on readyState would leave the
        // video permanently in noReadyState + stuck at the same timestamp, with
        // +5s on the clock having no visible effect.

        // Overshoot guard: if the rate was adjusted and the video has now caught
        // up or crossed the target, reset to 1× before any other branch runs.
        // Without this, a long seek (e.g. a 4K hardware-decoder stall) can leave
        // diff jumping straight from −50 to well past +50 in a single tick, and
        // the original narrow reset window misses it entirely — rate stays at 4×
        // and the video runs away until the next jump threshold.
        if (hasAdjustedRate) {
            if (currentRate > expectedRate && diffMs > -50) {
                this.setRate(entry, expectedRate, now);
                this.onSyncEvent({ type: "rateToOne", id: entry.id, t: now, diffMs });
                return;
            }
            if (currentRate < expectedRate && diffMs < 50) {
                this.setRate(entry, expectedRate, now);
                this.onSyncEvent({ type: "rateToOne", id: entry.id, t: now, diffMs });
                return;
            }
        }

        if (!hasAdjustedRate && diffMs > 100 && diffMs < 2000) {
            this.setRate(entry, 0.25 * expectedRate, now);
            this.onSyncEvent({ type: "slowDown", id: entry.id, t: now, diffMs, rate: video.playbackRate });
        } else if (diffMs >= 2000) {
            this.jumpToExpected(entry, expectedTime, diffMs, expectedRate, now);
        } else if (diffMs < -2500) {
            this.jumpToExpected(entry, expectedTime, diffMs, expectedRate, now);
        } else if (diffMs < -500 && !hasAdjustedRate) {
            console.log("SPEEDUP")
            this.setRate(entry, Math.min(4, 4 * expectedRate), now);
            this.onSyncEvent({ type: "speedUp", id: entry.id, t: now, diffMs, rate: video.playbackRate });
        } else if (diffMs < -250 && !hasAdjustedRate) {
            this.setRate(entry, 3 * expectedRate, now);
            this.onSyncEvent({ type: "speedUp", id: entry.id, t: now, diffMs, rate: video.playbackRate });
        } else if (diffMs < -100 && !hasAdjustedRate) {
            this.setRate(entry, 1.5 * expectedRate, now);
            this.onSyncEvent({ type: "speedUp", id: entry.id, t: now, diffMs, rate: video.playbackRate });
        } else if (diffMs > -50 && diffMs < 50 && currentRate !== expectedRate && hasAdjustedRate) {
            this.setRate(entry, expectedRate, now);
            this.onSyncEvent({ type: "rateToOne", id: entry.id, t: now, diffMs });
        }
    }

    syncWhilePaused(entry, expectedTime, now) {
        const { video } = entry;
        const diffMs = this.computeDiffMs(video, expectedTime);

        this.onSyncEvent({
            type: "diff",
            id: entry.id,
            t: now,
            diffMs,
            rate: video.playbackRate,
            readyState: video.readyState,
            jumpLatencyMs: this.jumpLatencyMonitor.getLatencyMs(entry.id),
        });

        if (!this.enabled) return;
        if (!video.paused) return;
        if (Math.abs(diffMs) < PAUSED_SYNC_THRESHOLD_MS) return;

        entry.awaitingSync = true;
        this.setRate(entry, USER_SELECTED_PLAYBACK_RATE, now);
        // No latency comp while paused: the timeline isn't moving.
        // Also don't register latency (the monitor skips paused players anyway).
        this.enqueueSeek(entry, expectedTime);
        this.onSyncEvent({ type: "jump", id: entry.id, t: now, diffMs, rate: USER_SELECTED_PLAYBACK_RATE });
    }

    jumpToExpected(entry, expectedTime, diffMs, expectedRate, now) {
        const jumpLatencySec = this.jumpLatencyMonitor.getLatencyMs(entry.id) / 1000;
        const rawTarget = expectedTime + jumpLatencySec;

        // Always reset the playback rate, even if the jump is deferred. Keeping
        // a 4× rate while we wait for buffering to catch up just overshoots
        // further and triggers another jump on the next tick.
        this.setRate(entry, expectedRate, now);

        // Don't seek into an unbuffered range. Chrome clamps the seek to the
        // end of the buffered range and cancels any in-progress fetch, which
        // means the file never finishes downloading and every subsequent seek
        // also clamps to the same spot. Let the video play forward naturally
        // (which keeps the download making progress) and retry the seek once
        // the target is actually buffered.
        if (!isBuffered(entry.video, rawTarget)) {
            this.onSyncEvent({
                type: "jumpDeferred",
                id: entry.id,
                t: now,
                diffMs,
                rate: expectedRate,
                currentTime: entry.video.currentTime,
                rawTarget,
                reason: "target-not-buffered",
            });
            return;
        }

        entry.awaitingSync = true;
        this.jumpLatencyMonitor.registerStart(entry.id, now, entry.video.currentTime, entry.video.paused);
        this.onSyncEvent({
            type: "jump",
            id: entry.id,
            t: now,
            diffMs,
            rate: expectedRate,
            currentTime: entry.video.currentTime,
            expectedTime,
            rawTarget,
            videoDuration: entry.video.duration,
            clockDuration: this.clock?.duration,
            buffered: rangesToString(entry.video.buffered),
            seekable: rangesToString(entry.video.seekable),
        });
        this.enqueueSeek(entry, rawTarget);
    }

    // Queue a seek. The dispatcher in syncAll performs it once the video has had
    // MIN_CAN_DRAW_TICKS consecutive ticks of readyState >= HAVE_CURRENT_DATA,
    // or MAX_SEEK_QUEUE_TICKS have passed (deadlock escape hatch). Latest target
    // wins; if a seek is already in flight, the new target simply overwrites.
    enqueueSeek(entry, target) {
        const clamped = Math.max(0.01, Math.min(entry.video.duration - 0.1, target));
        entry.pendingSeekTarget = clamped;
        entry.pendingSeekQueuedAt = performance.now();
    }

    performSeek(entry) {
        const target = entry.pendingSeekTarget;
        entry.pendingSeekTarget = null;
        // Reset so the next seek must wait its own 2 ticks after this one lands.
        entry.canDrawTicks = 0;
        entry.video.currentTime = target;
    }

    getJumpLatencyMs(id) {
        return this.jumpLatencyMonitor.getLatencyMs(id);
    }

    release() {
        this.stop();
        this.entries = [];
    }
}
