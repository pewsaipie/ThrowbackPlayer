import { getContext } from "./audio";
import type { Tape, Track } from "../state";

function env(data: Float32Array, i: number, a: number, r: number, peak: number): number {
  if (i < a) return (i / a) * peak;
  if (i > data.length - r) return Math.max(0, peak * (1 - (i - (data.length - r)) / r));
  return peak;
}

function paintKick(ch: Float32Array, sr: number, at: number, amp: number): void {
  const n = Math.floor(sr * 0.18);
  const start = Math.floor(at * sr);
  for (let i = 0; i < n && start + i < ch.length; i++) {
    const t = i / sr;
    const f = 140 * Math.exp(-t * 18) + 38;
    const e = Math.exp(-t * 14) * amp;
    ch[start + i] += Math.sin(2 * Math.PI * f * t) * e;
  }
}

function paintSnare(ch: Float32Array, sr: number, at: number, amp: number): void {
  const n = Math.floor(sr * 0.12);
  const start = Math.floor(at * sr);
  for (let i = 0; i < n && start + i < ch.length; i++) {
    const t = i / sr;
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 22);
    const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 16);
    ch[start + i] += (noise * 0.7 + tone * 0.3) * amp;
  }
}

function paintHat(ch: Float32Array, sr: number, at: number, amp: number): void {
  const n = Math.floor(sr * 0.04);
  const start = Math.floor(at * sr);
  for (let i = 0; i < n && start + i < ch.length; i++) {
    const t = i / sr;
    ch[start + i] += (Math.random() * 2 - 1) * Math.exp(-t * 55) * amp;
  }
}

function paintTone(
  ch: Float32Array,
  sr: number,
  at: number,
  dur: number,
  freq: number,
  amp: number,
  kind: "sine" | "triangle" = "sine",
): void {
  const n = Math.floor(sr * dur);
  const start = Math.floor(at * sr);
  for (let i = 0; i < n && start + i < ch.length; i++) {
    const t = i / sr;
    const phase = 2 * Math.PI * freq * t;
    const wave = kind === "triangle" ? 2 * Math.asin(Math.sin(phase)) / Math.PI : Math.sin(phase);
    const e = env(ch.subarray(start, start + n), i, sr * 0.01, sr * 0.04, amp);
    ch[start + i] += wave * e;
  }
}

const A3 = 220;
const notes: Record<string, number> = {
  A: A3,
  C: A3 * Math.pow(2, 3 / 12),
  D: A3 * Math.pow(2, 5 / 12),
  E: A3 * Math.pow(2, 7 / 12),
  F: A3 * Math.pow(2, 8 / 12),
  G: A3 * Math.pow(2, 10 / 12),
};

async function render(seconds: number, paint: (ch: Float32Array, sr: number) => void): Promise<AudioBuffer> {
  const c = getContext();
  const sr = c.sampleRate;
  const offline = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
  const buf = offline.createBuffer(2, Math.floor(sr * seconds), sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  paint(L, sr);
  for (let i = 0; i < L.length; i++) {
    R[i] = L[i] * 0.92 + (Math.random() - 0.5) * 0.002;
  }
  // gentle limiter
  let peak = 0.001;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.85 / peak;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return buf;
}

function nightDesk(ch: Float32Array, sr: number): void {
  const bpm = 76;
  const beat = 60 / bpm;
  const bars = 10;
  for (let b = 0; b < bars * 4; b++) {
    const t = b * beat;
    paintKick(ch, sr, t, 0.9);
    if (b % 2 === 1) paintSnare(ch, sr, t, 0.35);
    paintHat(ch, sr, t + beat * 0.5, 0.18);
    const chord = b % 8 < 4 ? ["A", "C", "E"] : ["G", "C", "E"];
    for (const n of chord) {
      paintTone(ch, sr, t, beat * 0.95, notes[n] / 2, 0.11, "triangle");
      paintTone(ch, sr, t, beat * 0.9, notes[n], 0.05);
    }
  }
}

function steadyRun(ch: Float32Array, sr: number): void {
  const bpm = 98;
  const beat = 60 / bpm;
  for (let b = 0; b < 12 * 4; b++) {
    const t = b * beat;
    paintKick(ch, sr, t, 0.8);
    if (b % 4 === 2) paintKick(ch, sr, t + beat * 0.5, 0.4);
    if (b % 2 === 1) paintSnare(ch, sr, t, 0.4);
    paintHat(ch, sr, t, 0.16);
    paintHat(ch, sr, t + beat * 0.5, 0.1);
    const bass = b % 8 < 4 ? notes.A / 2 : notes.D / 2;
    paintTone(ch, sr, t, beat * 0.7, bass, 0.28, "sine");
    if (b % 4 === 0) {
      paintTone(ch, sr, t, beat * 2, notes.E * 2, 0.08, "triangle");
    }
  }
}

function limiterOff(ch: Float32Array, sr: number): void {
  const bpm = 64;
  const beat = 60 / bpm;
  for (let b = 0; b < 8 * 4; b++) {
    const t = b * beat;
    if (b % 4 === 0) paintKick(ch, sr, t, 0.5);
    paintHat(ch, sr, t + beat * 0.5, 0.08);
    const pad = b % 16 < 8 ? ["A", "C", "E"] : ["F", "A", "C"];
    for (const n of pad) {
      paintTone(ch, sr, t, beat * 1.8, notes[n], 0.07);
      paintTone(ch, sr, t, beat * 1.8, notes[n] * 2, 0.03, "triangle");
    }
  }
}

function metalTape(ch: Float32Array, sr: number): void {
  const bpm = 110;
  const beat = 60 / bpm;
  for (let b = 0; b < 12 * 4; b++) {
    const t = b * beat;
    paintKick(ch, sr, t, 0.85);
    if (b % 2 === 1) paintSnare(ch, sr, t, 0.45);
    paintHat(ch, sr, t, 0.22);
    paintHat(ch, sr, t + beat * 0.25, 0.1);
    paintHat(ch, sr, t + beat * 0.5, 0.16);
    const bass = [notes.A / 2, notes.A / 2, notes.G / 2, notes.E / 2][b % 4];
    paintTone(ch, sr, t, beat * 0.55, bass, 0.3);
    if (b % 2 === 0) paintTone(ch, sr, t, beat * 0.4, notes.A * 2, 0.07, "triangle");
  }
}

async function track(title: string, seconds: number, paint: (ch: Float32Array, sr: number) => void): Promise<Track> {
  const buffer = await render(seconds, paint);
  return { title, duration: buffer.duration, buffer };
}

export async function makeDemoTape(): Promise<Tape> {
  const [a1, a2, b1, b2] = await Promise.all([
    track("Night Desk", 18, nightDesk),
    track("Steady Run", 16, steadyRun),
    track("Limiter Off", 18, limiterOff),
    track("Metal Tape", 16, metalTape),
  ]);
  return {
    id: "demo-field-notes",
    title: "Field Notes",
    kind: "demo",
    sideA: [a1, a2],
    sideB: [b1, b2],
  };
}

export function makeBlank(id = "blank-c60"): Tape {
  return {
    id,
    title: "Blank C-60",
    kind: "blank",
    sideA: [],
    sideB: [],
  };
}
