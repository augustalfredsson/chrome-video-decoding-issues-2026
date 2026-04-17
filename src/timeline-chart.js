// Rolling timeline chart: one row per stream, color-coded by readyState.
// Green = HAVE_ENOUGH_DATA (4), yellow = HAVE_FUTURE_DATA (3),
// orange = HAVE_CURRENT_DATA (2), red = HAVE_METADATA (1) / nothing (0).

const COLORS = {
    4: "#3ddc84",
    3: "#9fd356",
    2: "#ffe600",
    1: "#e8553d",
    0: "#8a0000",
};

const ROW_HEIGHT = 22;
const ROW_PAD = 4;
const LABEL_W = 90;

export class TimelineChart {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.windowMs = options.windowMs ?? 120000; // 2 minutes rolling
    }

    resize(streamCount) {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.canvas.clientWidth;
        const cssHeight = streamCount * (ROW_HEIGHT + ROW_PAD) + 24;
        this.canvas.style.height = `${cssHeight}px`;
        this.canvas.width = cssWidth * dpr;
        this.canvas.height = cssHeight * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw(history, sessionMs, globalStallEvents) {
        const ids = Object.keys(history);
        this.resize(ids.length);

        const ctx = this.ctx;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const plotW = w - LABEL_W - 8;

        ctx.clearRect(0, 0, w, h);

        const endMs = sessionMs;
        const startMs = Math.max(0, endMs - this.windowMs);
        const range = endMs - startMs;
        const toX = (t) => LABEL_W + ((t - startMs) / range) * plotW;

        // Background
        ctx.fillStyle = "#111";
        ctx.fillRect(LABEL_W, 0, plotW, h);

        // Global-stall highlight strips
        ctx.fillStyle = "rgba(255, 60, 60, 0.25)";
        for (const event of globalStallEvents) {
            const s = event.startMs;
            const e = event.endMs ?? endMs;
            if (e < startMs) continue;
            const x1 = toX(Math.max(s, startMs));
            const x2 = toX(Math.min(e, endMs));
            ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
        }

        // Per-stream rows
        ctx.font = "12px system-ui, sans-serif";
        ctx.textBaseline = "middle";

        ids.forEach((id, i) => {
            const rowY = i * (ROW_HEIGHT + ROW_PAD) + ROW_PAD;
            ctx.fillStyle = "#ddd";
            ctx.fillText(id, 4, rowY + ROW_HEIGHT / 2);

            const samples = history[id];
            if (!samples || samples.length === 0) return;

            // Draw a segment between consecutive samples.
            for (let j = 0; j < samples.length - 1; j++) {
                const a = samples[j];
                const b = samples[j + 1];
                if (b.t < startMs) continue;
                if (a.t > endMs) break;
                const x1 = toX(Math.max(a.t, startMs));
                const x2 = toX(Math.min(b.t, endMs));
                ctx.fillStyle = COLORS[a.readyState] ?? "#555";
                ctx.fillRect(x1, rowY, Math.max(1, x2 - x1), ROW_HEIGHT);
            }
            // Last sample extends to `now`.
            const last = samples[samples.length - 1];
            if (last.t <= endMs) {
                const x1 = toX(Math.max(last.t, startMs));
                const x2 = toX(endMs);
                ctx.fillStyle = COLORS[last.readyState] ?? "#555";
                ctx.fillRect(x1, rowY, Math.max(1, x2 - x1), ROW_HEIGHT);
            }
        });

        // X-axis ticks every 15s
        ctx.fillStyle = "#888";
        ctx.textBaseline = "top";
        const tickStart = Math.ceil(startMs / 15000) * 15000;
        for (let t = tickStart; t <= endMs; t += 15000) {
            const x = toX(t);
            ctx.fillRect(x, h - 18, 1, 6);
            ctx.fillText(`${Math.round(t / 1000)}s`, x + 2, h - 18);
        }
    }
}
