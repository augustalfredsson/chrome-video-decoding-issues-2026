// Canvas chart of sync events over the last N seconds, one row per video.

const EVENT_COLORS = {
  diff: "#3B82F6",
  slowDown: "#EF4444",
  jump: "#8B5CF6",
  speedUp: "#10B981",
  rateToOne: "#F59E0B",
  awaitSync: "#ffd3d3",
  awaitReset: "#22d3ee",
  noReadyState: "#ffea2d",
};

const SEEKING_COLOR = "#ff6b6b";
const PAUSE_COLOR = "#eeff00";

const HISTORY_MS = 15000;
const ROW_MIN_HEIGHT = 60;
const TOP_PAD = 28;
const BOTTOM_PAD = 18;

export class SyncDebugTimeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  resize(streamCount) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth;
    const rowHeight = Math.max(ROW_MIN_HEIGHT, Math.floor(80));
    const cssHeight = Math.max(1, streamCount) * rowHeight + TOP_PAD + BOTTOM_PAD;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cssWidth, cssHeight, rowHeight };
  }

  draw({ events, seekingPeriods, pausedByStream, streamIds, nowMs }) {
    const { cssWidth, cssHeight, rowHeight } = this.resize(streamIds.length);
    const ctx = this.ctx;

    ctx.fillStyle = "#16171b";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (streamIds.length === 0) return;

    const startMs = nowMs - HISTORY_MS;
    const xOf = (t) => ((t - startMs) / HISTORY_MS) * cssWidth;

    // Vertical time grid
    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const x = (i / 6) * cssWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
      ctx.stroke();
    }

    // Time labels across the bottom
    ctx.fillStyle = "#9ca3af";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i <= 6; i++) {
      const x = (i / 6) * cssWidth;
      const secondsAgo = Math.round(HISTORY_MS / 1000 - i * (HISTORY_MS / 1000 / 6));
      ctx.fillText(`-${secondsAgo}s`, x, cssHeight - 4);
    }

    // diff (ms) → pixels; 100 ms = 10 px so ±600 ms spans 120 px, clamped into row.
    const diffToPx = (diffMs) => diffMs / 10;
    const clampPx = (px, halfRow) => {
      const max = halfRow - halfRow * 0.2;
      return Math.max(-max, Math.min(max, px));
    };

    streamIds.forEach((id, i) => {
      const yBase = TOP_PAD + i * rowHeight;
      const yCenter = yBase + rowHeight / 2;
      const halfRow = rowHeight / 2;

      // Row separator above
      if (i > 0) {
        ctx.strokeStyle = "#4b5563";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yBase);
        ctx.lineTo(cssWidth, yBase);
        ctx.stroke();
      }

      // Seeking bands
      const periods = seekingPeriods.filter((p) => p.id === id);
      for (const period of periods) {
        const s = Math.max(period.startMs, startMs);
        const e = Math.min(period.endMs ?? nowMs, nowMs);
        if (e < startMs || s > nowMs) continue;
        const x1 = xOf(s);
        const x2 = xOf(e);
        ctx.fillStyle = SEEKING_COLOR + "30";
        ctx.fillRect(x1, yBase, Math.max(1, x2 - x1), rowHeight);
        ctx.strokeStyle = SEEKING_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, yBase);
        ctx.lineTo(x1, yBase + rowHeight);
        ctx.moveTo(x2, yBase);
        ctx.lineTo(x2, yBase + rowHeight);
        ctx.stroke();
      }

      // Horizontal diff tick lines
      for (const t of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) {
        const px = -diffToPx(t * 1000);
        if (Math.abs(px) > halfRow - halfRow * 0.2) continue;
        ctx.strokeStyle = t === 0 ? "#6b7280" : "#272e3e";
        ctx.lineWidth = t === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(0, yCenter + px);
        ctx.lineTo(cssWidth, yCenter + px);
        ctx.stroke();
        ctx.fillStyle = "#6b7280";
        ctx.font = "10px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(t.toFixed(1), cssWidth - 4, yCenter + px + 3);
      }

      // Row label top-left
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(id, 6, yBase + 12);

      // Plot events
      const myEvents = [];
      for (const ev of events) {
        if (ev.id !== id) continue;
        if (ev.t < startMs || ev.t > nowMs) continue;
        myEvents.push(ev);
      }

      let lastDiffMs = null;
      let lastRate = null;
      let lastJumpLatencyMs = null;
      let lastDiffLabelValue = Number.NaN;

      for (const ev of myEvents) {
        const x = xOf(ev.t);
        const yOff = ev.diffMs !== undefined ? clampPx(-diffToPx(ev.diffMs), halfRow) : 0;
        const y = yCenter + yOff;
        ctx.fillStyle = EVENT_COLORS[ev.type] ?? "#6b7280";

        if (ev.rate !== undefined) lastRate = ev.rate;
        if (ev.jumpLatencyMs !== undefined) lastJumpLatencyMs = ev.jumpLatencyMs;

        switch (ev.type) {
          case "diff": {
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
            ctx.fill();
            lastDiffMs = ev.diffMs;
            const diffSeconds = ev.diffMs / 1000;
            if (Math.abs(diffSeconds - lastDiffLabelValue) > 0.1) {
              lastDiffLabelValue = diffSeconds;
              ctx.fillStyle = "#f3f4f6";
              ctx.font = "10px system-ui, sans-serif";
              ctx.textAlign = "center";
              const offset = ev.diffMs > 0 ? -8 : 14;
              ctx.fillText(diffSeconds.toFixed(2), x, y + offset);
            }
            break;
          }
          case "jump": {
            ctx.beginPath();
            ctx.moveTo(x, y - 5);
            ctx.lineTo(x - 4, y + 4);
            ctx.lineTo(x + 4, y + 4);
            ctx.closePath();
            ctx.fill();
            break;
          }
          case "slowDown": {
            ctx.fillRect(x - 3, y - 6, 3, 6);
            break;
          }
          case "speedUp": {
            ctx.fillRect(x - 2, y - 6, 4, 4);
            break;
          }
          case "rateToOne": {
            ctx.fillRect(x - 2, y - 2, 4, 4);
            break;
          }
          case "awaitSync": {
            ctx.fillRect(x - 1, y - 1, 2, 2);
            break;
          }
          case "awaitReset": {
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
            break;
          }
          case "noReadyState": {
            // Full-height bar — consecutive ticks form a solid
            // stripe showing the duration of the stall.
            ctx.globalAlpha = 0.55;
            ctx.fillRect(x - 0.5, yBase, 1, rowHeight);
            ctx.globalAlpha = 1;
            break;
          }
          default:
            break;
        }
      }

      // Paused marker (yellow ring) along the top of the row
      if (pausedByStream?.[id]) {
        ctx.strokeStyle = PAUSE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cssWidth - 12, yBase + 12, 4, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Latest ΔD / rate label in top-right
      if (lastDiffMs !== null) {
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "right";
        const pauseOffset = pausedByStream?.[id] ? 22 : 4;
        const rateStr = lastRate !== null ? `  rate ${lastRate.toFixed(2)}×` : "";
        const latStr = lastJumpLatencyMs !== null ? `  jumpLat ${lastJumpLatencyMs.toFixed(0)}ms` : "";
        ctx.fillText(`ΔD ${lastDiffMs.toFixed(0)}ms${rateStr}${latStr}`, cssWidth - pauseOffset, yBase + 12);
      }
    });
  }
}
