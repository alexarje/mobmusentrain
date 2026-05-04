/* global AudioContext, webkitAudioContext */
/* ═══════════════════════════════════════════════════════════════════════════
   MobMusEntrain — app.js
   Multi-device rhythmic entrainment via the Web Audio API + Kuramoto model
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ──────────────────────────────────────────────────────────────────────────

  const BPM_MIN  = 72;
  const BPM_MAX  = 144;
  const STEPS    = 16;   // 16th-note steps per bar

  // Kuramoto coupling strengths (conservative — entrains over ~8–16 beats)
  const PHASE_COUPLING = 0.18;  // fraction of phase error corrected per beat
  const TEMPO_COUPLING = 0.04;  // fraction of BPM error corrected per beat

  // Web Audio look-ahead scheduler
  const LOOK_AHEAD_SEC  = 0.12;  // schedule notes this far ahead
  const SCHED_INTERVAL  = 28;    // ms between scheduler wakeups

  // Musical harmonic ratios for tempo alignment
  const HARMONIC_RATIOS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3];

  // Device hue palette (HSL)
  const PEER_HUES = [160, 0, 190, 50, 280, 330, 220];

  // Preset patterns — { name, kick[], hat[], snr[], ton[] } — 16 steps each
  const PATTERNS = [
    {
      name: 'Pulse',
      kick: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      snr:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    {
      name: 'Groove',
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      hat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snr:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    {
      name: 'Techno',
      kick: [1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,0,0],
      hat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snr:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,1,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    {
      name: 'Clave',
      // Son clave 3-2 in 16 steps: beats 0,3,6,10,12
      kick: [1,0,0,1, 0,0,1,0, 0,0,1,0, 1,0,0,0],
      hat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snr:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      ton:  [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
    },
    {
      name: 'Kpanlogo',
      // Ghanaian youth dance — asymmetric djembe-based 4/4 pattern
      kick: [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
      hat:  [1,0,1,1, 0,1,0,1, 1,0,1,0, 1,0,1,0],
      snr:  [0,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,1,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      voices: { kick: 'djembeBass', hat: 'shaker', snr: 'djembeSlap', ton: 'ton' },
    },
    {
      name: 'Fanga',
      // West African welcome ceremony rhythm
      kick: [1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,0,0],
      hat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snr:  [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,1,0,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      voices: { kick: 'djembeBass', hat: 'shaker', snr: 'djembeSlap', ton: 'ton' },
    },
    {
      name: 'Keherwa',
      // North Indian 8-beat taal (Dha Ge Na Ti | Na Ka Dhi Na), 2 steps per beat
      kick: [1,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snr:  [1,0,1,0, 1,0,1,0, 0,0,1,0, 1,0,1,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      voices: { kick: 'tablaBayan', hat: 'kanjira', snr: 'tablaDayan', ton: 'ton' },
    },
    {
      name: 'Rupak',
      // North Indian 7-beat taal (3+2+2), adapted to 16 steps (14 active + 2 rest)
      kick: [0,0,0,0, 0,0,1,0, 1,0,1,0, 1,0,0,0],
      hat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,0,0],
      snr:  [1,0,1,0, 1,0,1,0, 0,0,1,0, 0,0,0,0],
      ton:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      voices: { kick: 'tablaBayan', hat: 'kanjira', snr: 'tablaDayan', ton: 'ton' },
    },
  ];

  // A-minor pentatonic (A3–A4 range), used for tone hits
  const PENTATONIC = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25];

  // Sequencer row labels keyed by voice name
  const VOICE_LABELS = {
    kick: 'KICK', hat: 'HAT',  snr: 'SNR',  ton: 'TONE',
    djembeBass: 'DJMB', djembeSlap: 'SLAP', shaker: 'SHKR',
    tablaBayan: 'BYAN', tablaDayan: 'DYAN', kanjira: 'KANJ',
  };

  // ──────────────────────────────────────────────────────────────────────────
  // GLOBAL STATE
  // ──────────────────────────────────────────────────────────────────────────

  let audioCtx      = null;
  let masterGain    = null;
  let compressor    = null;
  let reverbSend    = null;   // gain node into reverb
  let noiseBuffer   = null;   // pre-baked 2-second white-noise buffer

  let isPlaying     = false;
  let bpm           = BPM_MIN + Math.random() * (BPM_MAX - BPM_MIN) * 0.5 + 10; // 82–118
  let currentStep   = 0;
  let nextStepTime  = 0;      // audio-clock time of the upcoming step
  let beatCount     = 0;
  let schedulerTimer = null;

  // Wall-clock time (ms) when the last bar's beat-1 was scheduled to fire
  let lastBeatWallMs = 0;

  // Active pattern (mutable copy of a preset)
  let currentPattern = deepClone(PATTERNS[0]);
  let currentPresetIndex = 0;

  // peers: Map<deviceId, { hue, lastBeatAudioTime, bpm }>
  const peers = new Map();
  let peerHueIndex = 1; // index into PEER_HUES (0 = self)

  let ws          = null;
  let isConnected = false;
  let roomId      = null;
  let deviceId    = 'dev_' + Math.random().toString(36).slice(2, 8);
  let reconnectTimer = null;

  let animFrameId  = null;
  let wakeLock     = null;

  // ──────────────────────────────────────────────────────────────────────────
  // UTILS
  // ──────────────────────────────────────────────────────────────────────────

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function generateRoomCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUDIO ENGINE
  // ──────────────────────────────────────────────────────────────────────────

  function initAudio() {
    if (audioCtx) return;

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();

    // Pre-bake 2 seconds of white noise (reused for all percussion)
    const len = audioCtx.sampleRate * 2;
    noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const nd = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // Signal chain: instruments → compressor → masterGain → output
    //                                        ↘ reverbSend → reverb → masterGain
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.82;

    compressor.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    // Build a simple algorithmic reverb (impulse response from decaying noise)
    const reverb    = audioCtx.createConvolver();
    const irLen     = Math.floor(audioCtx.sampleRate * 1.6);
    const irBuf     = audioCtx.createBuffer(2, irLen, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.8);
      }
    }
    reverb.buffer = irBuf;

    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.18;

    reverbSend = audioCtx.createGain();
    reverbSend.gain.value = 1;

    reverbSend.connect(reverb);
    reverb.connect(reverbGain);
    reverbGain.connect(masterGain);
  }

  function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  /** Noise burst helper — creates a BufferSource from the shared noise buffer */
  function makeNoise(duration) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    // Clamp duration to buffer length; offset randomly to avoid tonal repetition
    const safeDur   = Math.min(duration, noiseBuffer.duration);
    const maxOffset = Math.max(0, noiseBuffer.duration - safeDur);
    src.loopStart = Math.random() * maxOffset;
    src.loopEnd   = src.loopStart + safeDur;
    src.loop = true;
    return src;
  }

  /** Kick drum — sub sine sweep + transient click */
  function playKick(time, vel = 0.9) {
    // Sub body
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.frequency.setValueAtTime(155, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.065);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vel * 0.95, time + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.38);
    osc.connect(env);
    env.connect(compressor);
    osc.start(time);
    osc.stop(time + 0.42);

    // Transient click (highpassed noise)
    const click = makeNoise(0.012);
    const hp    = audioCtx.createBiquadFilter();
    hp.type     = 'highpass';
    hp.frequency.value = 80;
    const cEnv  = audioCtx.createGain();
    cEnv.gain.setValueAtTime(vel * 0.38, time);
    cEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
    click.connect(hp);
    hp.connect(cEnv);
    cEnv.connect(compressor);
    click.start(time);
    click.stop(time + 0.014);
  }

  /** Closed/open hi-hat — hi-passed noise */
  function playHat(time, vel = 0.5, open = false) {
    const noise = makeNoise(0.35);
    const hp    = audioCtx.createBiquadFilter();
    hp.type     = 'highpass';
    hp.frequency.value = 7500;
    const bp    = audioCtx.createBiquadFilter();
    bp.type     = 'bandpass';
    bp.frequency.value = 11000;
    bp.Q.value  = 0.6;
    const env   = audioCtx.createGain();
    const decay = open ? 0.28 : 0.04;
    env.gain.setValueAtTime(vel, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + decay);
    noise.connect(hp);
    hp.connect(bp);
    bp.connect(env);
    env.connect(compressor);
    noise.start(time);
    noise.stop(time + decay + 0.005);
  }

  /** Snare — noisy with tonal body + room send */
  function playSnare(time, vel = 0.7) {
    // Tonal body
    const body    = audioCtx.createOscillator();
    body.type     = 'triangle';
    body.frequency.setValueAtTime(190, time);
    body.frequency.exponentialRampToValueAtTime(95, time + 0.05);
    const bodyEnv = audioCtx.createGain();
    bodyEnv.gain.setValueAtTime(vel * 0.28, time);
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    body.connect(bodyEnv);
    bodyEnv.connect(compressor);
    body.start(time);
    body.stop(time + 0.09);

    // Snare noise
    const noise  = makeNoise(0.22);
    const hp     = audioCtx.createBiquadFilter();
    hp.type      = 'highpass';
    hp.frequency.value = 1800;
    const nEnv   = audioCtx.createGain();
    nEnv.gain.setValueAtTime(vel, time);
    nEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    noise.connect(hp);
    hp.connect(nEnv);
    nEnv.connect(compressor);
    if (reverbSend) nEnv.connect(reverbSend);
    noise.start(time);
    noise.stop(time + 0.16);
  }

  /** Melodic tone — two detuned sines on the pentatonic scale */
  function playTone(time, vel = 0.38, noteIdx = 0) {
    const freq = PENTATONIC[noteIdx % PENTATONIC.length];
    const env  = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vel, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
    env.connect(compressor);
    if (reverbSend) env.connect(reverbSend);

    // Two oscillators: a sine fundamental + a slightly-detuned triangle one octave up.
    // The 0.2 % detuning (2.002×) creates a gentle chorus/shimmer effect.
    [1, 2.002].forEach((mult) => {
      const o = audioCtx.createOscillator();
      o.type = mult === 1 ? 'sine' : 'triangle';
      o.frequency.value = freq * mult;
      o.connect(env);
      o.start(time);
      o.stop(time + 0.6);
    });
  }

  /** Djembe bass — warm low tone, fast attack, medium decay */
  function playDjembeBass(time, vel = 0.85) {
    const osc = audioCtx.createOscillator();
    osc.type  = 'sine';
    const env = audioCtx.createGain();
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(68, time + 0.04);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vel * 0.9, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(env);
    env.connect(compressor);
    osc.start(time);
    osc.stop(time + 0.32);

    // Body thud — bandpass noise burst
    const noise = makeNoise(0.015);
    const bp    = audioCtx.createBiquadFilter();
    bp.type     = 'bandpass';
    bp.frequency.value = 260;
    bp.Q.value  = 1.4;
    const nEnv  = audioCtx.createGain();
    nEnv.gain.setValueAtTime(vel * 0.35, time);
    nEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
    noise.connect(bp);
    bp.connect(nEnv);
    nEnv.connect(compressor);
    noise.start(time);
    noise.stop(time + 0.02);
  }

  /** Djembe slap — bright sharp mid-high finger strike */
  function playDjembeSlap(time, vel = 0.7) {
    const osc = audioCtx.createOscillator();
    osc.type  = 'triangle';
    const env = audioCtx.createGain();
    osc.frequency.setValueAtTime(520, time);
    osc.frequency.exponentialRampToValueAtTime(320, time + 0.025);
    env.gain.setValueAtTime(vel * 0.6, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(env);
    env.connect(compressor);
    osc.start(time);
    osc.stop(time + 0.1);

    const noise = makeNoise(0.06);
    const hp    = audioCtx.createBiquadFilter();
    hp.type     = 'highpass';
    hp.frequency.value = 1200;
    const nEnv  = audioCtx.createGain();
    nEnv.gain.setValueAtTime(vel * 0.5, time);
    nEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.connect(hp);
    hp.connect(nEnv);
    nEnv.connect(compressor);
    noise.start(time);
    noise.stop(time + 0.065);
  }

  /** Shaker / shekere — rattling bandpass noise */
  function playShaker(time, vel = 0.45) {
    const noise = makeNoise(0.08);
    const bp    = audioCtx.createBiquadFilter();
    bp.type     = 'bandpass';
    bp.frequency.value = 6000;
    bp.Q.value  = 0.7;
    const hp    = audioCtx.createBiquadFilter();
    hp.type     = 'highpass';
    hp.frequency.value = 4000;
    const env   = audioCtx.createGain();
    env.gain.setValueAtTime(vel, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    noise.connect(bp);
    bp.connect(hp);
    hp.connect(env);
    env.connect(compressor);
    noise.start(time);
    noise.stop(time + 0.08);
  }

  /** Tabla bayan — Indian bass drum, low pitched with resonant pitch glide */
  function playTablaBayan(time, vel = 0.85) {
    const osc = audioCtx.createOscillator();
    osc.type  = 'sine';
    const env = audioCtx.createGain();
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.exponentialRampToValueAtTime(52, time + 0.08);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vel * 0.88, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    osc.connect(env);
    env.connect(compressor);
    if (reverbSend) env.connect(reverbSend);
    osc.start(time);
    osc.stop(time + 0.36);
  }

  /** Tabla dayan — Indian treble drum, bright ring with inharmonic overtones */
  function playTablaDayan(time, vel = 0.65) {
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vel, time + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    env.connect(compressor);

    // Three partials — inharmonic spacing gives the characteristic tabla ring
    [[440, 1.0], [585, 0.45], [880, 0.2]].forEach(([freq, amp]) => {
      const o = audioCtx.createOscillator();
      o.type  = 'sine';
      o.frequency.setValueAtTime(freq, time);
      o.frequency.exponentialRampToValueAtTime(freq * 0.94, time + 0.06);
      const g = audioCtx.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(env);
      o.start(time);
      o.stop(time + 0.2);
    });

    // Attack transient
    const click = makeNoise(0.006);
    const bp    = audioCtx.createBiquadFilter();
    bp.type     = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value  = 1.8;
    const cEnv  = audioCtx.createGain();
    cEnv.gain.setValueAtTime(vel * 0.4, time);
    cEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.008);
    click.connect(bp);
    bp.connect(cEnv);
    cEnv.connect(compressor);
    click.start(time);
    click.stop(time + 0.01);
  }

  /** Kanjira — small South Indian frame drum, very short and crisp */
  function playKanjira(time, vel = 0.55) {
    const osc = audioCtx.createOscillator();
    osc.type  = 'triangle';
    const env = audioCtx.createGain();
    osc.frequency.setValueAtTime(260, time);
    osc.frequency.exponentialRampToValueAtTime(190, time + 0.018);
    env.gain.setValueAtTime(vel * 0.55, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(env);
    env.connect(compressor);
    osc.start(time);
    osc.stop(time + 0.06);

    const noise = makeNoise(0.04);
    const hp    = audioCtx.createBiquadFilter();
    hp.type     = 'highpass';
    hp.frequency.value = 2800;
    const nEnv  = audioCtx.createGain();
    nEnv.gain.setValueAtTime(vel * 0.38, time);
    nEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.038);
    noise.connect(hp);
    hp.connect(nEnv);
    nEnv.connect(compressor);
    noise.start(time);
    noise.stop(time + 0.04);
  }

  // Dispatch map: voice name → (time, step) → plays the right instrument
  const VOICE_FNS = {
    kick:       (t, s) => playKick(t),
    hat:        (t, s) => playHat(t, 0.52, s === 6 || s === 14),
    snr:        (t, s) => playSnare(t),
    ton:        (t, s) => playTone(t, 0.38, Math.floor(s / 2) % PENTATONIC.length),
    djembeBass: (t, s) => playDjembeBass(t),
    djembeSlap: (t, s) => playDjembeSlap(t),
    shaker:     (t, s) => playShaker(t),
    tablaBayan: (t, s) => playTablaBayan(t),
    tablaDayan: (t, s) => playTablaDayan(t),
    kanjira:    (t, s) => playKanjira(t),
  };

  // ──────────────────────────────────────────────────────────────────────────
  // SCHEDULER (Web Audio clock-based lookahead)
  // ──────────────────────────────────────────────────────────────────────────

  function stepDurationSec()  { return (60 / bpm) / 4; }
  function beatDurationSec()  { return 60 / bpm; }
  function beatDurationMs()   { return beatDurationSec() * 1000; }

  function scheduleStep(step, time) {
    const p = currentPattern;
    const v = p.voices || {};
    if (p.kick[step]) VOICE_FNS[v.kick || 'kick'](time, step);
    if (p.hat[step])  VOICE_FNS[v.hat  || 'hat' ](time, step);
    if (p.snr[step])  VOICE_FNS[v.snr  || 'snr' ](time, step);
    if (p.ton[step])  VOICE_FNS[v.ton  || 'ton' ](time, step);

    // On the downbeat (step 0) — record wall time and broadcast beat
    if (step === 0) {
      const msUntil = (time - audioCtx.currentTime) * 1000;
      const beatWall = Date.now() + Math.max(0, msUntil);

      // Update lastBeatWallMs when the beat actually fires
      setTimeout(() => { lastBeatWallMs = Date.now(); }, Math.max(0, msUntil));

      broadcastBeat(beatWall);
      beatCount++;
    }

    // Update step indicator asynchronously (don't block audio thread)
    const stepCopy = step;
    setTimeout(() => highlightStep(stepCopy), 0);
  }

  function runScheduler() {
    if (!isPlaying || !audioCtx) return;
    while (nextStepTime < audioCtx.currentTime + LOOK_AHEAD_SEC) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepDurationSec();
      currentStep   = (currentStep + 1) % STEPS;
    }
    schedulerTimer = setTimeout(runScheduler, SCHED_INTERVAL);
  }

  function startPlayback() {
    initAudio();
    resumeAudio();
    isPlaying    = true;
    currentStep  = 0;
    beatCount    = 0;
    nextStepTime = audioCtx.currentTime + 0.06;
    lastBeatWallMs = Date.now();
    runScheduler();
    updatePlayButton(true);
    acquireWakeLock();
  }

  function stopPlayback() {
    isPlaying = false;
    clearTimeout(schedulerTimer);
    updatePlayButton(false);
    releaseWakeLock();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ENTRAINMENT — Kuramoto-inspired phase + tempo coupling
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Called when a peer's beat event arrives.
   * peerBeatWallMs — wall-clock time (ms) when the peer's beat fired.
   * peerBpm        — peer's current tempo.
   */
  function receivePeerBeat(peerId, peerBeatWallMs, peerBpm) {
    if (!isPlaying || !audioCtx) return;

    // Store / update peer record
    const existing = peers.get(peerId);
    const hue = existing ? existing.hue : PEER_HUES[peerHueIndex++ % PEER_HUES.length];
    peers.set(peerId, {
      hue,
      bpm: peerBpm,
      lastBeatAudioTime: audioCtx.currentTime,
      lastBeatWallMs: peerBeatWallMs,
    });

    applyEntrainment(peerBeatWallMs, peerBpm);
  }

  function applyEntrainment(peerBeatWallMs, peerBpm) {
    const myBeatMs = beatDurationMs();

    // Phase of peer's beat within our cycle — [0, 1)
    // elapsed = how long after our last downbeat the peer fired
    const elapsed = peerBeatWallMs - lastBeatWallMs;
    let phase = ((elapsed % myBeatMs) + myBeatMs) % myBeatMs / myBeatMs;

    // Fold to [-0.5, 0.5] so we always take the shorter arc
    if (phase > 0.5) phase -= 1;

    // ── Phase correction (Kuramoto) ──────────────────────────
    // δθ = -K * sin(2π * phase)    (phase of self relative to peer)
    // Time shift: move nextStepTime to advance/retard our phase
    const deltaTheta   = -PHASE_COUPLING * Math.sin(2 * Math.PI * phase);
    const timeShiftSec = deltaTheta / (2 * Math.PI) * beatDurationSec();
    nextStepTime -= timeShiftSec;

    // Clamp: never jump nextStepTime into the past
    if (nextStepTime < audioCtx.currentTime + 0.002) {
      nextStepTime = audioCtx.currentTime + 0.002;
    }

    // ── Tempo correction ─────────────────────────────────────
    // Find the nearest musical harmonic ratio between peer and self
    const ratio        = peerBpm / bpm;
    const nearestRatio = findNearestHarmonicRatio(ratio);
    const targetBpm    = peerBpm / nearestRatio;

    if (targetBpm >= BPM_MIN && targetBpm <= BPM_MAX) {
      const bpmError = targetBpm - bpm;
      bpm += clamp(bpmError, -3, 3) * TEMPO_COUPLING;
      bpm  = clamp(bpm, BPM_MIN, BPM_MAX);
    }

    updateBpmDisplay();
  }

  function findNearestHarmonicRatio(ratio) {
    let nearest = 1;
    let minDist = Infinity;
    for (const r of HARMONIC_RATIOS) {
      const d = Math.abs(ratio - r);
      if (d < minDist) { minDist = d; nearest = r; }
    }
    return nearest;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // NETWORK — WebSocket room communication
  // ──────────────────────────────────────────────────────────────────────────

  function getServerWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function connectToRoom(room) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    clearTimeout(reconnectTimer);
    roomId = room;

    try {
      ws = new WebSocket(getServerWsUrl());
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      isConnected = true;
      ws.send(JSON.stringify({ type: 'join', room: roomId, deviceId }));
      updateConnectionUI(true);
    };

    ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      isConnected = false;
      updateConnectionUI(false);
      scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (roomId) reconnectTimer = setTimeout(() => connectToRoom(roomId), 3500);
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'joined':
        updatePeersDisplay(msg.peerCount);
        showShareSection(msg.roomId);
        break;
      case 'peer_joined':
        updatePeersDisplay(msg.peerCount - 1);
        showToast('+ device joined');
        break;
      case 'peer_left':
        peers.delete(msg.deviceId);
        updatePeersDisplay(msg.peerCount);
        break;
      case 'peer_beat':
        receivePeerBeat(msg.deviceId, msg.timestamp, msg.bpm);
        break;
      case 'peer_pattern':
        // We don't auto-apply peer patterns, just note they changed
        break;
    }
  }

  function broadcastBeat(beatWallMs) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'beat',
      timestamp: beatWallMs,
      bpm: Math.round(bpm * 10) / 10,
      beatCount,
    }));
  }

  function broadcastPattern(idx) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'pattern', patternIndex: idx }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VISUALISER — Phase clock canvas
  // ──────────────────────────────────────────────────────────────────────────

  const canvas = document.getElementById('phase-canvas');
  const ctx2d  = canvas ? canvas.getContext('2d') : null;

  function resizeCanvas() {
    if (!canvas) return;
    const w = Math.min(canvas.parentElement.clientWidth - 24, 290);
    canvas.width  = w;
    canvas.height = w;
  }

  function startViz() {
    if (!canvas || animFrameId) return;
    resizeCanvas();
    animLoop();
  }

  function animLoop() {
    drawFrame();
    animFrameId = requestAnimationFrame(animLoop);
  }

  /** Self phase in [0, 1) within the current bar (16 steps) */
  function selfPhase() {
    if (!audioCtx || !isPlaying) return 0;
    // Interpolate sub-step position for smooth hand animation
    const lastStepTime  = nextStepTime - stepDurationSec();
    const stepProgress  = clamp((audioCtx.currentTime - lastStepTime) / stepDurationSec(), 0, 1);
    return ((currentStep + stepProgress) / STEPS) % 1;
  }

  function drawFrame() {
    if (!ctx2d) return;
    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R  = Math.min(W, H) * 0.42;

    ctx2d.clearRect(0, 0, W, H);

    // ── Outer ring ──
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, R, 0, Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx2d.lineWidth   = 1;
    ctx2d.stroke();

    // ── Beat tick marks (4 beats) ──
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      ctx2d.beginPath();
      ctx2d.moveTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9));
      ctx2d.lineTo(cx + Math.cos(a) * R,       cy + Math.sin(a) * R);
      ctx2d.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx2d.lineWidth   = 2.5;
      ctx2d.stroke();
    }

    // ── Step dots (16 steps) ──
    for (let i = 0; i < STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R;
      ctx2d.beginPath();
      ctx2d.arc(x, y, i % 4 === 0 ? 0 : 1.8, 0, Math.PI * 2);
      ctx2d.fillStyle = i === currentStep ? '#fff' : 'rgba(255,255,255,0.18)';
      ctx2d.fill();
    }

    // ── Self phase hand ──
    const sp  = selfPhase();
    const sa  = sp * Math.PI * 2 - Math.PI / 2;
    ctx2d.beginPath();
    ctx2d.moveTo(cx, cy);
    ctx2d.lineTo(cx + Math.cos(sa) * R * 0.72, cy + Math.sin(sa) * R * 0.72);
    ctx2d.strokeStyle = `hsl(${PEER_HUES[0]}, 100%, 60%)`;
    ctx2d.lineWidth   = 3;
    ctx2d.lineCap     = 'round';
    ctx2d.stroke();

    // ── Peer phase dots ──
    peers.forEach((peer) => {
      if (!peer.lastBeatAudioTime || !audioCtx) return;
      const elapsed    = audioCtx.currentTime - peer.lastBeatAudioTime;
      const peerBeatSec = 60 / (peer.bpm || bpm);
      const peerPhase  = (elapsed % peerBeatSec) / peerBeatSec;
      const pa         = peerPhase * Math.PI * 2 - Math.PI / 2;
      const px         = cx + Math.cos(pa) * R * 0.86;
      const py         = cy + Math.sin(pa) * R * 0.86;

      ctx2d.beginPath();
      ctx2d.arc(px, py, 7, 0, Math.PI * 2);
      ctx2d.fillStyle = `hsl(${peer.hue}, 90%, 62%)`;
      ctx2d.fill();
    });

    // ── Centre pulse ──
    const pulseScale = isPlaying
      ? 4 + 7 * Math.pow(Math.max(0, 1 - (sp * STEPS) % 1), 3)
      : 3.5;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, pulseScale, 0, Math.PI * 2);
    ctx2d.fillStyle = isPlaying
      ? `hsl(${PEER_HUES[0]}, 100%, 62%)`
      : 'rgba(255,255,255,0.25)';
    ctx2d.fill();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SEQUENCER UI
  // ──────────────────────────────────────────────────────────────────────────

  function buildSequencerGrid() {
    const grid = document.getElementById('sequencer-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const voices = currentPattern.voices || {};
    const rows = [
      { key: 'kick', label: VOICE_LABELS[voices.kick || 'kick'] },
      { key: 'hat',  label: VOICE_LABELS[voices.hat  || 'hat' ] },
      { key: 'snr',  label: VOICE_LABELS[voices.snr  || 'snr' ] },
      { key: 'ton',  label: VOICE_LABELS[voices.ton  || 'ton' ] },
    ];

    rows.forEach(({ key, label }) => {
      const row = document.createElement('div');
      row.className = 'seq-row';

      const lbl = document.createElement('span');
      lbl.className   = 'seq-label';
      lbl.textContent = label;
      row.appendChild(lbl);

      for (let i = 0; i < STEPS; i++) {
        const cell = document.createElement('div');
        cell.className        = 'seq-step';
        cell.dataset.key      = key;
        cell.dataset.step     = i;
        if (currentPattern[key][i]) cell.classList.add('on');

        const handler = (e) => {
          e.preventDefault();
          toggleStep(key, i);
        };
        cell.addEventListener('touchstart', handler, { passive: false });
        cell.addEventListener('click',      handler);
        row.appendChild(cell);
      }

      grid.appendChild(row);
    });
  }

  function toggleStep(key, step) {
    currentPattern[key][step] = currentPattern[key][step] ? 0 : 1;
    const cell = document.querySelector(`.seq-step[data-key="${key}"][data-step="${step}"]`);
    if (cell) cell.classList.toggle('on', !!currentPattern[key][step]);
  }

  function highlightStep(step) {
    document.querySelectorAll('.seq-step').forEach((cell) => {
      const s = parseInt(cell.dataset.step, 10);
      cell.classList.toggle('active-step', s === step);
    });
  }

  function buildPresetButtons() {
    const container = document.getElementById('preset-buttons');
    if (!container) return;

    PATTERNS.forEach((pat, i) => {
      const btn = document.createElement('button');
      btn.className   = 'preset-btn' + (i === 0 ? ' selected' : '');
      btn.textContent = pat.name;
      btn.addEventListener('click', () => selectPreset(i));
      container.appendChild(btn);
    });
  }

  function selectPreset(index) {
    currentPattern     = deepClone(PATTERNS[index]);
    currentPresetIndex = index;
    buildSequencerGrid();
    document.querySelectorAll('.preset-btn').forEach((b, i) => {
      b.classList.toggle('selected', i === index);
    });
    broadcastPattern(index);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UI HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  function updatePlayButton(playing) {
    const btn = document.getElementById('play-btn');
    if (!btn) return;
    btn.textContent = playing ? 'STOP' : 'START';
    btn.classList.toggle('playing', playing);
  }

  function updateBpmDisplay() {
    const el = document.getElementById('bpm-display');
    if (el) el.textContent = Math.round(bpm) + ' BPM';
  }

  function updateConnectionUI(connected) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    el.textContent = connected ? '● Connected' : '○ Offline';
    el.classList.toggle('connected', connected);
  }

  function updatePeersDisplay(count) {
    const el = document.getElementById('peers-display');
    if (el) el.textContent = count + (count === 1 ? ' peer' : ' peers');
  }

  function showShareSection(room) {
    const sec  = document.getElementById('share-section');
    const link = document.getElementById('share-link');
    if (!sec || !link) return;
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    link.href        = url.toString();
    link.textContent = url.toString();
    sec.style.display = '';
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className   = 'peer-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WAKE LOCK (keep screen on during playback)
  // ──────────────────────────────────────────────────────────────────────────

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* not critical */ }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ROOM MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  function joinRoom(room) {
    room = room || generateRoomCode();
    const input = document.getElementById('room-input');
    if (input) input.value = room;

    // Reflect room in URL for easy sharing
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState({}, '', url);

    connectToRoom(room);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────────────────

  function init() {
    // Pre-fill room from URL if present
    const params     = new URLSearchParams(location.search);
    const urlRoom    = params.get('room');
    const roomInput  = document.getElementById('room-input');
    if (urlRoom && roomInput) roomInput.value = urlRoom;

    // Play / stop
    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.addEventListener('click', () => {
      if (isPlaying) stopPlayback(); else startPlayback();
    });

    // Join room
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) joinBtn.addEventListener('click', () => {
      const room = (roomInput ? roomInput.value.trim().toLowerCase() : '') || null;
      joinRoom(room);
    });

    // Join on Enter key in room input
    if (roomInput) roomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom(roomInput.value.trim().toLowerCase() || null);
    });

    // Build UI
    buildPresetButtons();
    buildSequencerGrid();

    // Initial BPM readout
    updateBpmDisplay();

    // Canvas
    startViz();
    window.addEventListener('resize', resizeCanvas);

    // Auto-join if room in URL
    if (urlRoom) joinRoom(urlRoom);

    // Re-acquire wake lock after visibility change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && isPlaying) acquireWakeLock();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
