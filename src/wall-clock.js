// External wall clock that advances in real time while running. All videos
// sync against this. Mirrors Cloud Studio's production clock: videos chase a
// reference that isn't itself a media element.

export class WallClock {
    constructor(duration = 30) {
        this.duration = duration;
        this.baseAccumSec = 0; // clock position at the instant `baseMs` was set
        this.baseMs = null; // null ⇒ paused; number ⇒ running since then
        this.listeners = new Set();
    }

    setDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        if (this.duration === seconds) return;
        // Wrap existing position into the new range.
        const cur = this.getExpectedSeconds();
        this.duration = seconds;
        this.baseAccumSec = ((cur % seconds) + seconds) % seconds;
        if (this.baseMs !== null) this.baseMs = performance.now();
        this.emit();
    }

    getExpectedSeconds() {
        let pos = this.baseAccumSec;
        if (this.baseMs !== null) {
            pos += (performance.now() - this.baseMs) / 1000;
        }
        const dur = this.duration;
        pos = ((pos % dur) + dur) % dur;
        return pos;
    }

    isRunning() {
        return this.baseMs !== null;
    }

    start() {
        if (this.baseMs !== null) return;
        this.baseMs = performance.now();
        this.emit();
    }

    pause() {
        if (this.baseMs === null) return;
        this.baseAccumSec = this.getExpectedSeconds();
        this.baseMs = null;
        this.emit();
    }

    toggle() {
        if (this.isRunning()) this.pause();
        else this.start();
    }

    nudge(deltaSeconds) {
        const cur = this.getExpectedSeconds();
        const dur = this.duration;
        this.baseAccumSec = (((cur + deltaSeconds) % dur) + dur) % dur;
        if (this.baseMs !== null) this.baseMs = performance.now();
        this.emit();
    }

    reset() {
        this.baseAccumSec = 0;
        this.baseMs = null;
        this.emit();
    }

    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit() {
        for (const fn of this.listeners) fn();
    }
}
