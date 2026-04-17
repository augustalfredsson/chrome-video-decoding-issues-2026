import { SyncController } from "./sync-controller.js";
import { StreamMonitor } from "./monitor.js";
import { SyncDebugTimeline } from "./sync-debug-timeline.js";
import { GLVideoRenderer } from "./gl-renderer.js";
import { WallClock } from "./wall-clock.js";

const grid = document.getElementById("video-grid");
const statsEl = document.getElementById("stats");
const eventLogEl = document.getElementById("event-log");
const syncChartCanvas = document.getElementById("sync-timeline");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const playPauseBtn = document.getElementById("play-pause-btn");
const seekBackBtn = document.getElementById("seek-back-btn");
const seekFwdBtn = document.getElementById("seek-fwd-btn");
const syncToggle = document.getElementById("sync-toggle");
const count4k = document.getElementById("count-4k");
const count720 = document.getElementById("count-720");
const url4k = document.getElementById("url-4k");
const url720 = document.getElementById("url-720");

let sync = null;
let monitor = null;
let syncChart = null;
let clock = null;
let glRenderers = [];
let hlsInstances = [];

function attachSource(video, url, id) {
    const isHls = /\.m3u8(\?|$)/i.test(url);
    if (!isHls) {
        video.src = url;
        return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        return;
    }
    if (typeof Hls === "undefined" || !Hls.isSupported()) {
        logEvent(`hls.js not available for ${id}, falling back to native`);
        video.src = url;
        return;
    }
    const hls = new Hls({
        debug: true,
    });
    hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
            logEvent(`hls fatal ${id}: ${data.type}/${data.details}`);
        }
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hlsInstances.push(hls);
}
let syncEvents = []; // ring buffer of sync events (last ~20s)
let seekingPeriods = []; // { id, startMs, endMs|null }
let pausedByStream = {}; // id -> boolean
let streamIds = [];
let sampleTimer = null;
let renderTimer = null;
let syncChartRafId = null;

const SYNC_EVENT_HISTORY_MS = 20000;

function pruneSyncEvents(nowMs) {
    const cutoff = nowMs - SYNC_EVENT_HISTORY_MS;
    let drop = 0;
    while (drop < syncEvents.length && syncEvents[drop].t < cutoff) drop++;
    if (drop > 0) syncEvents.splice(0, drop);
    seekingPeriods = seekingPeriods.filter((p) => (p.endMs ?? nowMs) >= cutoff);
}

function logEvent(text) {
    const line = document.createElement("div");
    const ts = (performance.now() / 1000).toFixed(2);
    line.textContent = `[${ts}s] ${text}`;
    eventLogEl.prepend(line);
    while (eventLogEl.childElementCount > 200) eventLogEl.lastChild.remove();
}

function buildTiles() {
    grid.innerHTML = "";
    const tiles = [];

    const mk = (id, url, cssW, cssH, backingW, backingH) => {
        const tile = document.createElement("div");
        tile.className = "tile tile--direct";
        tile.dataset.id = id;
        tile.style.width = `${cssW}px`;
        tile.style.height = `${cssH}px`;

        // Direct <video> rendering — no canvas / GL in between.
        const video = document.createElement("video");
        video.className = "tile-video tile-video--direct";
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";
        attachSource(video, url, id);
        video.addEventListener("error", () => {
            logEvent(`video error ${id}: ${video.error?.message ?? video.error?.code ?? "unknown"}`);
        });

        const overlay = document.createElement("div");
        overlay.className = "tile-overlay";
        overlay.textContent = id;

        tile.append(video, overlay);
        grid.append(tile);

        tiles.push({ id, video, canvas: null, renderer: null });
    };

    const n4k = parseInt(count4k.value, 10) || 0;
    const n720 = parseInt(count720.value, 10) || 0;
    for (let i = 0; i < n4k; i++) mk(`4k-${i}`, url4k.value, 480, 270, 3840, 2160);
    for (let i = 0; i < n720; i++) mk(`720-${i}`, url720.value, 320, 180, 1280, 720);
    return tiles;
}

function start() {
    stop();
    const tiles = buildTiles();
    if (tiles.length === 0) {
        logEvent("No streams configured");
        return;
    }

    syncEvents = [];
    seekingPeriods = [];
    pausedByStream = {};
    streamIds = tiles.map((t) => t.id);

    clock = new WallClock();
    // Pick up the duration from the first video whose metadata loads.
    const firstVideo = tiles[0].video;
    const applyDuration = () => {
        if (!Number.isFinite(firstVideo.duration) || firstVideo.duration <= 0) return;
        if (clock.duration !== firstVideo.duration) {
            logEvent(`clock duration ${clock.duration} → ${firstVideo.duration.toFixed(3)}`);
            clock.setDuration(firstVideo.duration);
        }
    };
    if (Number.isFinite(firstVideo.duration) && firstVideo.duration > 0) applyDuration();
    firstVideo.addEventListener("loadedmetadata", applyDuration);
    // Chrome can update `duration` after loadedmetadata (e.g., when the full
    // moov atom is parsed, or when a live stream's duration changes).
    firstVideo.addEventListener("durationchange", applyDuration);

    monitor = new StreamMonitor();
    sync = new SyncController({
        clock,
        enabled: syncToggle.checked,
        onSyncEvent: (e) => {
            if (e.type === "jump") {
                logEvent(
                    `sync jump ${e.id} (diff ${e.diffMs.toFixed(0)}ms) ` +
                    `current=${e.currentTime.toFixed(2)}s target=${e.rawTarget.toFixed(2)}s ` +
                    `buffered=${e.buffered} seekable=${e.seekable}`
                );
            }
            if (e.type === "jumpDeferred") {
                logEvent(
                    `sync jumpDeferred ${e.id} (diff ${e.diffMs.toFixed(0)}ms) ` +
                    `current=${e.currentTime.toFixed(2)}s target=${e.rawTarget.toFixed(2)}s [${e.reason}]`
                );
            }
            if (e.type === "awaitReset") logEvent(`sync await reset ${e.id}`);
            if (e.type === "playError") logEvent(`play() rejected ${e.id}: ${e.error}`);
            // Use performance.now()-derived timeline for the debug chart.
            syncEvents.push({ ...e, t: performance.now() });
        },
    });
    syncChart = new SyncDebugTimeline(syncChartCanvas);

    // Track seeking periods + paused state per stream for the debug chart.
    for (const t of tiles) {
        const id = t.id;
        const v = t.video;
        v.addEventListener("seeking", () => {
            seekingPeriods.push({ id, startMs: performance.now(), endMs: null });
            logEvent(`seeking ${id} @ ${v.currentTime.toFixed(2)}s rs=${v.readyState}`);
        });
        v.addEventListener("seeked", () => {
            const open = [...seekingPeriods].reverse().find((p) => p.id === id && p.endMs === null);
            const elapsed = open ? performance.now() - open.startMs : NaN;
            if (open) open.endMs = performance.now();
            logEvent(`seeked  ${id} @ ${v.currentTime.toFixed(2)}s rs=${v.readyState} (${elapsed.toFixed(0)}ms)`);
        });
        v.addEventListener("play", () => {
            pausedByStream[id] = false;
        });
        v.addEventListener("pause", () => {
            pausedByStream[id] = true;
        });
        pausedByStream[id] = v.paused;
    }

    monitor.addListener((ev) => {
        if (ev.kind === "stallStart") logEvent(`STALL start ${ev.id}`);
        if (ev.kind === "stallEnd") logEvent(`STALL end ${ev.id}`);
        if (ev.kind === "globalStallStart") logEvent(`GLOBAL STALL [${ev.streamIds.join(", ")}]`);
    });

    for (const t of tiles) {
        monitor.registerStream(t.id, t.video);
        sync.addVideo(t.id, t.video);
    }

    sync.start();
    clock.start();

    const updatePlayPauseLabel = () => {
        playPauseBtn.textContent = clock.isRunning() ? "Pause" : "Play";
    };
    clock.onChange(updatePlayPauseLabel);
    updatePlayPauseLabel();
    playPauseBtn.disabled = false;
    seekBackBtn.disabled = false;
    seekFwdBtn.disabled = false;

    sampleTimer = setInterval(() => monitor.sampleReadyState(performance.now()), 100);
    renderTimer = setInterval(render, 250);

    const syncChartLoop = () => {
        if (!syncChart) return;
        const nowMs = performance.now();
        pruneSyncEvents(nowMs);
        syncChart.draw({
            events: syncEvents,
            seekingPeriods,
            pausedByStream,
            streamIds,
            nowMs,
        });
        syncChartRafId = requestAnimationFrame(syncChartLoop);
    };
    syncChartRafId = requestAnimationFrame(syncChartLoop);
    logEvent(`started with ${tiles.length} streams`);
}

function stop() {
    if (sync) sync.release();
    for (const r of glRenderers) r.release();
    glRenderers = [];
    for (const h of hlsInstances) {
        try { h.destroy(); } catch (_) {}
    }
    hlsInstances = [];
    if (clock) clock.pause();
    clock = null;
    sync = null;
    monitor = null;
    syncChart = null;
    syncEvents = [];
    seekingPeriods = [];
    pausedByStream = {};
    streamIds = [];
    if (sampleTimer) clearInterval(sampleTimer);
    if (renderTimer) clearInterval(renderTimer);
    if (syncChartRafId) cancelAnimationFrame(syncChartRafId);
    sampleTimer = null;
    renderTimer = null;
    syncChartRafId = null;
    playPauseBtn.disabled = true;
    playPauseBtn.textContent = "Pause";
    seekBackBtn.disabled = true;
    seekFwdBtn.disabled = true;
}

function render() {
    if (!monitor) return;
    const global = monitor.getGlobalSnapshot();
    const per = monitor.getPerStreamSnapshot();

    const fmtMs = (ms) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);
    const clockPos = clock ? clock.getExpectedSeconds().toFixed(2) : "—";
    const clockState = clock ? (clock.isRunning() ? "▶" : "⏸") : "—";
    statsEl.innerHTML = `
      <div><b>clock</b>: ${clockPos}s ${clockState}</div>
      <div><b>session</b>: ${fmtMs(global.sessionMs)}</div>
      <div><b>global stalls</b>: ${global.totalGlobalStalls}</div>
      <div><b>time-to-first-stall</b>: ${fmtMs(global.firstStallMs)}</div>
      <div><b>stall freq</b>: ${global.globalStallFrequencyPerMin.toFixed(2)}/min</div>
      <div><b>in global stall</b>: ${global.inGlobalStall ? "yes" : "no"}</div>
    `;

    for (const stat of per) {
        const tile = grid.querySelector(`.tile[data-id="${stat.id}"]`);
        if (!tile) continue;
        const overlay = tile.querySelector(".tile-overlay");
        if (!overlay) continue;
        const stallTag = stat.stalled ? ' <span class="badge-stall">STALLED</span>' : "";
        const fps = stat.estimatedFps > 0 ? stat.estimatedFps.toFixed(1) : "—";
        const framesLine = stat.rvfcSupported
            ? `frames=${stat.presentedFrames}/${stat.expectedFrames} miss=${stat.missedFrames} @ ${fps}fps`
            : `drops=${stat.droppedVideoFrames}/${stat.totalVideoFrames} (no rVFC)`;
        overlay.innerHTML = `
          <div class="tile-label">${stat.id}${stallTag}</div>
          <div>rs=${stat.readyState} rate=${stat.playbackRate.toFixed(2)}</div>
          <div>t=${stat.currentTime.toFixed(2)}s</div>
          <div>${framesLine}</div>
          <div>res=${stat.videoWidth}×${stat.videoHeight}</div>
        `;
    }

}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
playPauseBtn.addEventListener("click", () => {
    if (!clock) return;
    clock.toggle();
    logEvent(`clock ${clock.isRunning() ? "running" : "paused"} @ ${clock.getExpectedSeconds().toFixed(2)}s`);
});

function nudgeClock(deltaSeconds) {
    if (!clock) {
        logEvent(`seek ignored: clock not running`);
        return;
    }
    const before = clock.getExpectedSeconds();
    clock.nudge(deltaSeconds);
    const after = clock.getExpectedSeconds();
    logEvent(`clock nudge ${deltaSeconds > 0 ? "+" : ""}${deltaSeconds}s: ${before.toFixed(2)}s → ${after.toFixed(2)}s`);
}

seekBackBtn.addEventListener("click", () => nudgeClock(-5));
seekFwdBtn.addEventListener("click", () => nudgeClock(5));
syncToggle.addEventListener("change", () => {
    if (sync) sync.setEnabled(syncToggle.checked);
    logEvent(`sync corrections ${syncToggle.checked ? "enabled" : "disabled"}`);
});
