import { getContext, unlock } from "./audio";

function noiseBuffer(seconds: number, color: "white" | "brown"): AudioBuffer {
  const c = getContext();
  const n = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function fire(
  buffer: AudioBuffer,
  opts: {
    gain?: number;
    duration?: number;
    highpass?: number;
    lowpass?: number;
    pitch?: number;
  } = {},
): void {
  const c = getContext();
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = opts.pitch ?? 1;
  const g = c.createGain();
  g.gain.value = opts.gain ?? 0.4;
  let node: AudioNode = src;
  if (opts.highpass) {
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = opts.highpass;
    node.connect(hp);
    node = hp;
  }
  if (opts.lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = opts.lowpass;
    node.connect(lp);
    node = lp;
  }
  node.connect(g);
  g.connect(c.destination);
  const t = c.currentTime;
  const dur = opts.duration ?? 0.08;
  g.gain.setValueAtTime(opts.gain ?? 0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.start(t);
  src.stop(t + dur + 0.02);
}

let clickBuf: AudioBuffer | null = null;
let clunkBuf: AudioBuffer | null = null;
let thunkBuf: AudioBuffer | null = null;
let motor: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

function ensure(): void {
  if (!clickBuf) clickBuf = noiseBuffer(0.05, "white");
  if (!clunkBuf) clunkBuf = noiseBuffer(0.2, "brown");
  if (!thunkBuf) thunkBuf = noiseBuffer(0.18, "brown");
}

export async function click(heavy = false): Promise<void> {
  await unlock();
  ensure();
  fire(clickBuf!, {
    gain: heavy ? 0.35 : 0.18,
    duration: heavy ? 0.07 : 0.04,
    highpass: 800,
    lowpass: 4200,
    pitch: 0.8 + Math.random() * 0.4,
  });
}

export async function clunk(): Promise<void> {
  await unlock();
  ensure();
  fire(clunkBuf!, { gain: 0.5, duration: 0.16, lowpass: 600, pitch: 0.5 });
  fire(clickBuf!, { gain: 0.12, duration: 0.05, highpass: 1200, pitch: 1.4 });
}

export async function thunk(): Promise<void> {
  await unlock();
  ensure();
  fire(thunkBuf!, { gain: 0.55, duration: 0.14, lowpass: 280, pitch: 0.35 });
}

export async function coverFlip(): Promise<void> {
  await unlock();
  ensure();
  fire(clickBuf!, { gain: 0.22, duration: 0.09, highpass: 400, lowpass: 1800, pitch: 1.1 });
}

export async function startMotor(rate = 1): Promise<void> {
  await unlock();
  stopMotor();
  const c = getContext();
  const buf = noiseBuffer(0.4, "brown");
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  const g = c.createGain();
  g.gain.value = 0.0001;
  src.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  src.start();
  g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.08);
  motor = { src, gain: g };
}

export function stopMotor(): void {
  if (!motor || !ctxSafe()) return;
  const c = getContext();
  try {
    motor.gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.12);
    motor.src.stop(c.currentTime + 0.14);
  } catch {
    /* already stopped */
  }
  motor = null;
}

function ctxSafe(): boolean {
  try {
    getContext();
    return true;
  } catch {
    return false;
  }
}
