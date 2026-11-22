// radio.js — 3-station car radio (Act 2, spec section 3.4).
//
// Behaviour, in plain terms:
//  * R cycles the station; the HUD shows the station name plus a small
//    animated equalizer. Three stations, each a distinct procedural
//    WebAudio loop (music only, no talk):
//      "Bay FM"      — synthwave, driving bass, 112 BPM
//      "Harbor Jazz" — slow swing, walking bass, 76 BPM
//      "Crescent Rock" — driving rock riff, 140 BPM
//  * Station 1 ("Bay FM") is the default on New Game. The radio keeps
//    playing through missions and free roam. It REPLACES the old single
//    music loop (audio.js startAmbient) — it does not play on top of it.
//  * Each station is a 16-step loop: a bass line, a chord stab and (on
//    rock) a riff lead, all scheduled from one lookahead timer. Notes
//    are plain semitone offsets from the station root, so the three
//    stations sound different even before the tempo/wave is counted.
//
// Integration: the base owns one Radio and stores it on game.radio
// (main.js already has the slot, null-safe, plus the R key and the HUD
// station-name line reading game.radioStation). Builder C wires:
//   game.radio = new Radio();            // in createGame (or boot)
//   game.radio.start();                  // where startAmbient() was called
//   game.radio.update(dt);               // once per fixed step
//   game.radio.drawEqualizer(ctx, x, y)  // in the HUD, next to the name
// The base must NOT call audio.startAmbient() anymore once the radio
// is wired — the radio is the music now. The class creates its own
// AudioContext lazily and only in a browser; in plain Node (scripted
// check) there is no audio at all, but station state, cycling and the
// equalizer still work and are fully testable. No other module is
// imported; the class is standalone.

export const STATIONS = [
  {
    id: 'bay-fm', name: 'Bay FM', blurb: 'synthwave, driving bass',
    bpm: 112, root: 110.0, wave: 'sawtooth', leadWave: 'triangle',
    // Driving 8th-note bass: root, root, octave, root, fifth...
    bass: [0, null, 0, null, 12, null, 0, null, 7, null, 0, null, 10, null, 12, null],
    // Soft pad chord on beats 1 and 3 (root + minor third + fifth).
    chords: [[0, 3, 7], null, null, null, [0, 3, 7], null, null, null,
             [-4, 0, 3], null, null, null, [5, 8, 12], null, null, null],
    lead: [null, null, 12, null, null, 15, null, null, 12, null, null, 19, null, null, 15, null],
    bassVol: 0.16, chordVol: 0.05, leadVol: 0.05,
  },
  {
    id: 'harbor-jazz', name: 'Harbor Jazz', blurb: 'slow swing, walking bass',
    bpm: 76, root: 130.81, wave: 'triangle', leadWave: 'sine',
    // Walking bass, one note per beat (steps 0,4,8,12), swing feel
    // comes from the longer step time, not from extra notes.
    bass: [0, null, null, null, 4, null, null, null, 7, null, null, null, 10, null, 7, null],
    // Mellow 7th chords on beats 1 and 3.
    chords: [[0, 4, 7, 10], null, null, null, [5, 9, 12, 15], null, null, null,
             [0, 4, 7, 10], null, null, null, [-2, 2, 5, 8], null, null, null],
    lead: [null, null, null, null, 12, null, null, 16, null, null, null, null, 19, null, 16, null],
    bassVol: 0.13, chordVol: 0.06, leadVol: 0.045,
  },
  {
    id: 'crescent-rock', name: 'Crescent Rock', blurb: 'driving rock riff',
    bpm: 140, root: 82.41, wave: 'square', leadWave: 'square',
    // Chugging root 8ths with octave kicks.
    bass: [0, 0, null, 0, 12, 0, null, 0, 0, 0, null, 0, 10, 0, 12, 7],
    // Power chords (root + fifth) on the off-beats.
    chords: [null, [0, 7], null, [0, 7], null, [0, 7], null, [0, 7],
             null, [0, 7], null, [0, 7], null, [-2, 5], null, [5, 12]],
    lead: [12, null, 12, null, 15, null, 12, null, 10, null, 12, null, 15, 19, 15, 12],
    bassVol: 0.14, chordVol: 0.05, leadVol: 0.06,
  },
];

export const DEFAULT_STATION_INDEX = 0; // Bay FM on New Game
export const EQUALIZER_BARS = 8;

function semiToFreq(root, semi) {
  return root * Math.pow(2, semi / 12);
}

export class Radio {
  constructor(options = {}) {
    this.index = DEFAULT_STATION_INDEX;
    this.playing = false;
    this.step = 0; // current 16th step inside the loop
    this.beatClock = 0; // seconds since the current station started (drives the EQ)
    this.timer = null; // lookahead scheduler handle
    this.nextStepTime = 0;
    this.audioCtx = options.audioContext || null; // injectable for tests
    this.volume = typeof options.volume === 'number' ? options.volume : 1;
  }

  get station() {
    return STATIONS[this.index];
  }

  get stationName() {
    return this.station.name;
  }

  get stationCount() {
    return STATIONS.length;
  }

  // Next station, wrapping 1 -> 2 -> 3 -> 1. Returns the new station.
  cycle() {
    return this.setStation((this.index + 1) % STATIONS.length);
  }

  // Set by index. Out-of-range indices are refused (station unchanged).
  // Returns the current station (after the call).
  setStation(i) {
    if (!Number.isInteger(i) || i < 0 || i >= STATIONS.length) return this.station;
    if (i !== this.index) {
      this.index = i;
      this.step = 0;
      this.beatClock = 0;
      if (this.playing && this.audioCtx) {
        this.nextStepTime = this.audioCtx.currentTime + 0.05;
      }
    }
    return this.station;
  }

  // Lazily create the browser AudioContext. In Node (no window) this
  // stays null and start() becomes a state-only call — the station
  // still cycles and the equalizer still animates for the scripted check.
  ensureAudio() {
    if (this.audioCtx) return this.audioCtx;
    if (typeof window === 'undefined') return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.audioCtx = new AC();
    } catch { this.audioCtx = null; }
    return this.audioCtx;
  }

  // Start the music. Safe to call in Node (no audio, state only).
  start() {
    if (this.playing) return true;
    this.playing = true;
    const ac = this.ensureAudio();
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      this.nextStepTime = ac.currentTime + 0.06;
      this.step = 0;
      if (typeof setInterval !== 'undefined' && !this.timer) {
        this.timer = setInterval(() => this.pump(), 40);
      }
    }
    return true;
  }

  stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    return true;
  }

  // Advance the beat clock (the base calls this once per fixed step).
  // The equalizer animates off this clock, so it moves even while the
  // audio scheduler is between notes.
  update(dt) {
    this.beatClock += dt;
  }

  stepDuration() {
    return 60 / this.station.bpm / 4; // one 16th step
  }

  // Lookahead scheduler: play every step whose time has come.
  pump() {
    const ac = this.audioCtx;
    if (!ac || !this.playing) return;
    while (this.nextStepTime < ac.currentTime + 0.12) {
      this.playStep(this.station, this.step, this.nextStepTime);
      this.step = (this.step + 1) % 16;
      this.nextStepTime += this.stepDuration();
    }
  }

  playStep(station, step, when) {
    const ac = this.audioCtx;
    if (!ac) return;
    const bassSemi = station.bass[step];
    if (bassSemi !== null && bassSemi !== undefined) {
      this.note(semiToFreq(station.root, bassSemi), this.stepDuration() * 1.8,
        station.wave, station.bassVol * this.volume, when);
    }
    const chord = station.chords[step];
    if (chord) {
      for (const semi of chord) {
        this.note(semiToFreq(station.root, semi), this.stepDuration() * 3.4,
          'triangle', station.chordVol * this.volume, when);
      }
    }
    const leadSemi = station.lead[step];
    if (leadSemi !== null && leadSemi !== undefined) {
      this.note(semiToFreq(station.root, leadSemi), this.stepDuration() * 1.6,
        station.leadWave, station.leadVol * this.volume, when);
    }
  }

  note(freq, dur, type, vol, when) {
    const ac = this.audioCtx;
    if (!ac) return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), when);
      gain.gain.setValueAtTime(vol, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(when);
      osc.stop(when + dur + 0.02);
    } catch { /* a failed note never stops the radio */ }
  }

  // Equalizer levels (0..1) for the HUD: 8 bars whose heights follow
  // the beat phase, with a per-station phase offset so each station's
  // animation looks different. Pure function of beatClock + station.
  equalizerLevels() {
    const st = this.station;
    const beat = this.beatClock * (st.bpm / 60);
    const levels = [];
    for (let i = 0; i < EQUALIZER_BARS; i++) {
      const phase = beat * Math.PI + i * 0.9 + this.index * 1.7;
      const low = 0.5 + 0.5 * Math.sin(phase);
      const high = 0.5 + 0.5 * Math.sin(phase * 2.3 + i);
      levels.push(Math.min(1, Math.max(0.08, 0.25 + 0.55 * low + 0.2 * high)));
    }
    return levels;
  }

  // Draw station name + equalizer bars on a canvas HUD context.
  // (x, y) is the top-left of the name line; bars sit under it.
  drawEqualizer(ctx, x, y) {
    if (!ctx) return;
    const levels = this.equalizerLevels();
    ctx.save();
    ctx.fillStyle = '#eef1f5';
    ctx.font = '20px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`♪ ${this.stationName}`, x, y);
    const barW = 7;
    const gap = 3;
    for (let i = 0; i < levels.length; i++) {
      const h = 4 + levels[i] * 18;
      ctx.fillStyle = i % 2 === 0 ? '#ffd34d' : '#4fc3f7';
      ctx.fillRect(x + i * (barW + gap), y + 8, barW, h);
    }
    ctx.restore();
  }

  toJSON() {
    return { station: this.index, playing: this.playing };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    if (Number.isInteger(data.station)) this.setStation(data.station);
    if (data.playing) this.start();
  }
}

// ---- scripted check -------------------------------------------------------
// Runs in Node (no DOM, no AudioContext) and in the browser console.
// Cycles all three stations and asserts the displayed station name
// changes each time (the acceptance check from spec section 7), plus
// equalizer animation, bounds, and Node-safe start/stop.
// Returns { passed, checks: [{ name, ok, detail }] }.
export function radioScriptedCheck() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const r = new Radio();

  check('three stations defined', STATIONS.length === 3, `count=${STATIONS.length}`);
  check('default station is Bay FM', r.stationName === 'Bay FM' && r.index === 0,
    `station=${r.stationName}`);
  check('station ids are unique',
    new Set(STATIONS.map((s) => s.id)).size === 3);
  check('stations differ in bpm/root/wave',
    new Set(STATIONS.map((s) => s.bpm)).size === 3
    && new Set(STATIONS.map((s) => s.root)).size === 3
    && new Set(STATIONS.map((s) => s.wave)).size === 3);

  const seen = [r.stationName];
  r.cycle();
  seen.push(r.stationName);
  check('cycle 1 -> Harbor Jazz', r.stationName === 'Harbor Jazz', `station=${r.stationName}`);
  r.cycle();
  seen.push(r.stationName);
  check('cycle 2 -> Crescent Rock', r.stationName === 'Crescent Rock', `station=${r.stationName}`);
  r.cycle();
  seen.push(r.stationName);
  check('cycle 3 wraps back to Bay FM', r.stationName === 'Bay FM', `station=${r.stationName}`);
  check('station name changed on every cycle',
    seen[0] !== seen[1] && seen[1] !== seen[2] && seen[2] !== seen[3],
    seen.join(' -> '));

  const set = r.setStation(2);
  check('setStation(2) selects Crescent Rock', set.name === 'Crescent Rock' && r.index === 2);
  r.setStation(99);
  check('setStation(99) is refused', r.index === 2 && r.stationName === 'Crescent Rock');
  r.setStation(-1);
  check('setStation(-1) is refused', r.index === 2);

  const levels0 = r.equalizerLevels();
  check('equalizer has 8 bars in [0,1]',
    levels0.length === EQUALIZER_BARS && levels0.every((v) => v >= 0 && v <= 1),
    JSON.stringify(levels0.map((v) => v.toFixed(2))));
  r.update(0.5);
  const levels1 = r.equalizerLevels();
  check('equalizer animates over time',
    levels1.some((v, i) => Math.abs(v - levels0[i]) > 0.01),
    `before=${levels0[0].toFixed(2)} after=${levels1[0].toFixed(2)}`);

  check('start() works with no audio in Node', r.start() === true && r.playing === true);
  check('stop() works with no audio in Node', r.stop() === true && r.playing === false);
  check('cycle() works while stopped', r.cycle().name === 'Bay FM');

  const rt = new Radio();
  rt.fromJSON({ station: 1, playing: false });
  check('save round-trip restores station', rt.stationName === 'Harbor Jazz');

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}
