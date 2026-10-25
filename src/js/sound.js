/**
 * Tiny synthesized sound-effect engine (Web Audio API).
 *
 * No audio files are shipped: every cue is generated on the fly so the app
 * stays fully offline. The AudioContext is created lazily and resumed on the
 * first user gesture, which keeps browsers' autoplay policies happy.
 */
(function (global) {
  "use strict";

  const AudioCtx = global.AudioContext || global.webkitAudioContext;

  const PATTERNS = {
    // Soft tick when a choice is highlighted.
    select: [{ f: 660, d: 0.06, t: "triangle", v: 0.05 }],
    // Tense double-beep for the final seconds of the timer.
    urgent: [
      { f: 1175, d: 0.09, t: "square", v: 0.07 },
      { f: 1480, d: 0.09, t: "square", v: 0.07, delay: 0.1 }
    ],
    // Neutral blip for confirmation prompts.
    confirm: [{ f: 520, d: 0.09, t: "sine", v: 0.07 }],
    // Two rising notes for a correct answer.
    correct: [
      { f: 659, d: 0.12, t: "sine", v: 0.08 },
      { f: 988, d: 0.16, t: "sine", v: 0.08, delay: 0.12 }
    ],
    // Descending buzz for a wrong answer / time-out.
    incorrect: [
      { f: 220, d: 0.18, t: "sawtooth", v: 0.07 },
      { f: 165, d: 0.22, t: "sawtooth", v: 0.07, delay: 0.16 }
    ],
    // Small ascending arpeggio when the quiz ends.
    finish: [
      { f: 523, d: 0.12, t: "sine", v: 0.08 },
      { f: 659, d: 0.12, t: "sine", v: 0.08, delay: 0.11 },
      { f: 784, d: 0.12, t: "sine", v: 0.08, delay: 0.22 },
      { f: 1047, d: 0.2, t: "sine", v: 0.09, delay: 0.33 }
    ]
  };

  let context = null;
  let enabled = true;

  function ensureContext() {
    if (!AudioCtx) {
      return null;
    }

    if (!context) {
      try {
        context = new AudioCtx();
      } catch (error) {
        context = null;
        return null;
      }
    }

    if (context.state === "suspended" && typeof context.resume === "function") {
      context.resume().catch(() => {});
    }

    return context;
  }

  function blip(frequency, duration, type, volume, delay) {
    const audio = ensureContext();

    if (!audio) {
      return;
    }

    const start = audio.currentTime + (delay || 0);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    const peak = typeof volume === "number" ? volume : 0.08;

    // Ramps in/out avoid the click that a hard start/stop would produce.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  const Sound = {
    /** Enables or disables all cues. */
    setEnabled(value) {
      enabled = Boolean(value);
    },

    /** @returns {boolean} whether cues are currently audible. */
    isEnabled() {
      return enabled;
    },

    /**
     * Plays a named cue. Unknown names and a disabled engine are no-ops.
     * @param {"select"|"urgent"|"confirm"|"correct"|"incorrect"|"finish"} name
     */
    play(name) {
      if (!enabled) {
        return;
      }

      const pattern = PATTERNS[name];

      if (!pattern) {
        return;
      }

      const audio = ensureContext();

      if (!audio) {
        return;
      }

      pattern.forEach((note) => blip(note.f, note.d, note.t, note.v, note.delay || 0));
    }
  };

  global.Sound = Sound;
})(window);
