// Tiny sound engine for the live quiz — synthesizes tones with the Web Audio
// API so there are no audio files to host. Call sfx('correct') etc.
let ctx = null;
function audio() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
    }
    // Browsers suspend audio until a user gesture; resume on demand.
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

// Play a sequence of notes: [{ f: freq, t: startSec, d: durSec, type, gain }]
function play(notes) {
    const ac = audio();
    if (!ac) return;
    const now = ac.currentTime;
    for (const n of notes) {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = n.type || 'sine';
        osc.frequency.value = n.f;
        const start = now + (n.t || 0);
        const dur = n.d || 0.15;
        const peak = n.gain ?? 0.2;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g); g.connect(ac.destination);
        osc.start(start); osc.stop(start + dur + 0.02);
    }
}

const SOUNDS = {
    join:    [{ f: 660, t: 0, d: 0.12 }, { f: 880, t: 0.1, d: 0.12 }],
    start:   [{ f: 523, t: 0, d: 0.12 }, { f: 659, t: 0.12, d: 0.12 }, { f: 784, t: 0.24, d: 0.18 }],
    tick:    [{ f: 880, t: 0, d: 0.06, gain: 0.12, type: 'square' }],
    timeup:  [{ f: 300, t: 0, d: 0.3, type: 'sawtooth', gain: 0.18 }],
    correct: [{ f: 659, t: 0, d: 0.12 }, { f: 784, t: 0.12, d: 0.12 }, { f: 1047, t: 0.24, d: 0.22 }],
    wrong:   [{ f: 200, t: 0, d: 0.25, type: 'sawtooth', gain: 0.18 }, { f: 150, t: 0.18, d: 0.25, type: 'sawtooth', gain: 0.18 }],
    reveal:  [{ f: 587, t: 0, d: 0.1 }, { f: 740, t: 0.1, d: 0.14 }],
    podium:  [{ f: 523, t: 0, d: 0.15 }, { f: 659, t: 0.15, d: 0.15 }, { f: 784, t: 0.3, d: 0.15 }, { f: 1047, t: 0.45, d: 0.3 }],
};

export function sfx(name) {
    const seq = SOUNDS[name];
    if (seq) play(seq);
}

// Call once on a user click to unlock audio on mobile browsers.
export function unlockAudio() { audio(); }
