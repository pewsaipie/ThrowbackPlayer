import { state } from "../state";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
let tapeEq: BiquadFilterNode | null = null;
let dolby: BiquadFilterNode | null = null;
let analyser: AnalyserNode | null = null;
let hissGain: GainNode | null = null;
let wow: OscillatorNode | null = null;
let wowGain: GainNode | null = null;
let sourceOut: GainNode | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micStream: MediaStream | null = null;

const vuData = new Uint8Array(2048);

export function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    buildGraph(ctx);
  }
  return ctx;
}

export async function unlock(): Promise<void> {
  const c = getContext();
  if (c.state === "suspended") await c.resume();
}

function buildGraph(c: AudioContext): void {
  sourceOut = c.createGain();
  sourceOut.gain.value = 1;

  tapeEq = c.createBiquadFilter();
  tapeEq.type = "highshelf";
  tapeEq.frequency.value = 6000;
  tapeEq.gain.value = -2;

  dolby = c.createBiquadFilter();
  dolby.type = "highshelf";
  dolby.frequency.value = 8000;
  dolby.gain.value = 0;

  limiter = c.createDynamicsCompressor();
  limiter.threshold.value = 0;
  limiter.knee.value = 0;
  limiter.ratio.value = 1;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  analyser = c.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;

  master = c.createGain();
  master.gain.value = 0.9;

  hissGain = c.createGain();
  hissGain.gain.value = 0.018;

  const hiss = makeHiss(c);
  hiss.connect(hissGain);

  wow = c.createOscillator();
  wow.type = "sine";
  wow.frequency.value = 0.55;
  wowGain = c.createGain();
  wowGain.gain.value = 0;
  wow.connect(wowGain);

  sourceOut.connect(tapeEq);
  tapeEq.connect(dolby);
  dolby.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(master);
  hissGain.connect(master);
  master.connect(c.destination);

  wow.start();
  applyDeckTone();
}

function makeHiss(c: AudioContext): AudioBufferSourceNode {
  const length = c.sampleRate * 2;
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  src.connect(hp);
  src.start();
  return src;
}

export function sourceInput(): GainNode {
  getContext();
  return sourceOut!;
}

export function wowDepth(): GainNode {
  getContext();
  return wowGain!;
}

export function applyDeckTone(): void {
  if (!tapeEq || !dolby || !limiter || !hissGain) return;

  const eq = { normal: -5, cro2: -1.5, metal: 3 }[state.tapeType];
  tapeEq.gain.value = eq;

  dolby.gain.value = state.dolby ? -8 : 0;
  const hiss = state.dolby ? 0.006 : 0.02;
  const ducked =
    state.transport === "play" || state.transport === "rec" ? hiss * 0.45 : hiss;
  hissGain.gain.setTargetAtTime(state.transport === "stop" ? hissed(0.012) : ducked, getContext().currentTime, 0.08);

  if (state.limiter) {
    limiter.threshold.value = -18;
    limiter.ratio.value = 8;
    limiter.knee.value = 6;
  } else {
    limiter.threshold.value = 0;
    limiter.ratio.value = 1;
    limiter.knee.value = 0;
  }

  wowGain!.gain.value = state.quartz ? 0 : 7;
}

function hissed(v: number): number {
  return state.dolby ? v * 0.35 : v;
}

export function vuLevels(): { l: number; r: number } {
  if (!analyser) return { l: 0, r: 0 };
  analyser.getByteTimeDomainData(vuData);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < vuData.length; i++) {
    const v = (vuData[i] - 128) / 128;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(sum / vuData.length);
  const l = Math.min(1, rms * 3.2);
  const r = Math.min(1, rms * 3.2 * (0.92 + peak * 0.15));
  return { l, r };
}

export async function attachMic(): Promise<MediaStream> {
  const c = getContext();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  micSource = c.createMediaStreamSource(micStream);
  micSource.connect(sourceInput());
  return micStream;
}

export function detachMic(): void {
  if (micSource) {
    try {
      micSource.disconnect();
    } catch {
      /* already gone */
    }
    micSource = null;
  }
  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
    micStream = null;
  }
}

export function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  return getContext().decodeAudioData(data.slice(0));
}
