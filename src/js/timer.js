/**
 * Timer
 * -----------------------------------------------------------
 * Countdown timer for a single question. It guarantees only ONE
 * interval is ever running, supports pause/resume/reset, and cleans
 * up its interval when stopped so leaks cannot accumulate.
 */
class Timer {
  /**
   * @param {object} options
   * @param {number}   options.duration Seconds per question (0 = disabled).
   * @param {Function} options.onTick   Called every second with (remaining, duration).
   * @param {Function} options.onTimeUp Called once when the countdown reaches zero.
   */
  constructor({ duration = 0, onTick = () => {}, onTimeUp = () => {} } = {}) {
    this.duration = Math.max(0, Number(duration) || 0);
    this.remaining = this.duration;
    this.onTick = onTick;
    this.onTimeUp = onTimeUp;
    this.intervalId = null;
    this.paused = false;
    this.stopped = false;
  }

  isEnabled() {
    return this.duration > 0;
  }

  isRunning() {
    return this.intervalId !== null;
  }

  isPaused() {
    return this.paused;
  }

  getRemaining() {
    return this.remaining;
  }

  /**
   * Sets the duration and resets the countdown.
   * @param {number} seconds
   */
  setDuration(seconds) {
    this.duration = Math.max(0, Number(seconds) || 0);
    this.remaining = this.duration;
    this.paused = false;
    this.stopped = false;
    this.emitTick();
  }

  /**
   * Starts the countdown. If an interval already exists it is ignored,
   * preventing duplicate intervals / double-speed countdowns.
   */
  start() {
    if (!this.isEnabled() || this.intervalId !== null) {
      return;
    }

    this.paused = false;
    this.stopped = false;
    this.emitTick();

    this.intervalId = window.setInterval(() => this.tick(), 1000);
  }

  tick() {
    if (this.stopped) {
      return;
    }

    this.remaining -= 1;
    this.emitTick();

    if (this.remaining <= 0) {
      this.remaining = 0;
      this.handleTimeUp();
    }
  }

  handleTimeUp() {
    this.stopped = true;
    this.clearIntervalHandle();
    this.onTimeUp();
  }

  pause() {
    if (this.intervalId === null) {
      return;
    }

    this.clearIntervalHandle();
    this.paused = true;
    this.stopped = true;
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this.start();
    }
  }

  /**
   * Stops and rewinds to the configured duration.
   * @param {number} [seconds]
   */
  reset(seconds = this.duration) {
    this.clearIntervalHandle();
    this.setDuration(seconds);
  }

  /**
   * Stops the timer and releases the interval (used when a quiz ends).
   */
  stop() {
    this.clearIntervalHandle();
    this.paused = false;
    this.stopped = true;
  }

  clearIntervalHandle() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  emitTick() {
    this.onTick(this.remaining, this.duration);
  }
}
