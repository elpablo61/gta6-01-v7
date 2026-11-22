// audio.js — procedural WebAudio sound effects. Music lives in the radio
// module (Builder B-2, radio.js): this module only plays short synth
// effects and exposes a tiny music hook the radio can drive. No audio
// files, no network.

export function createAudio() {
  let ctx = null;
  let muted = false;
  let musicTimer = null;
  let musicNote = 0;

  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = 'square', vol = 0.12, slideTo = null) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ac.currentTime + dur);
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + dur);
  }
  function noise(dur, vol = 0.15) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.connect(gain); gain.connect(ac.destination);
    src.start();
  }

  const sfx = {
    shoot() { noise(0.09, 0.2); tone(180, 0.08, 'square', 0.1, 60); },
    hit() { tone(140, 0.12, 'sawtooth', 0.12, 70); },
    pickup() { tone(660, 0.09, 'sine', 0.14); setTimeout(() => tone(880, 0.12, 'sine', 0.14), 70); },
    cash() { tone(880, 0.1, 'sine', 0.14); setTimeout(() => tone(1320, 0.16, 'sine', 0.14), 90); },
    crash() { noise(0.25, 0.25); tone(90, 0.2, 'sawtooth', 0.14, 40); },
    siren() { tone(700, 0.4, 'sine', 0.05, 950); },
    mission() { tone(523, 0.12, 'sine', 0.14); setTimeout(() => tone(784, 0.2, 'sine', 0.14), 110); },
    fail() { tone(220, 0.3, 'sawtooth', 0.12, 110); },
    engine() { tone(55, 0.3, 'sawtooth', 0.04, 90); },
  };

  // Minimal ambient loop (used only until the radio module takes over).
  // Bass notes walk a slow minor progression; the radio replaces this.
  function startAmbient() {
    if (musicTimer || muted) return;
    const bass = [55, 65.4, 49, 58.3];
    musicTimer = setInterval(() => {
      if (muted) return;
      tone(bass[musicNote % bass.length], 1.6, 'triangle', 0.05);
      musicNote += 1;
    }, 1800);
  }
  function stopAmbient() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  return { sfx, startAmbient, stopAmbient, ensure,
    setMuted(v) { muted = v; if (v) stopAmbient(); },
    get muted() { return muted; } };
}
