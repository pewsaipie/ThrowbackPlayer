export type Transport = "stop" | "play" | "pause" | "ff" | "rew" | "rec";
export type TapeType = "normal" | "cro2" | "metal";
export type Side = "A" | "B";

export interface Track {
  title: string;
  duration: number;
  buffer: AudioBuffer | null;
}

export interface Tape {
  id: string;
  title: string;
  kind: "demo" | "blank" | "user" | "take";
  sideA: Track[];
  sideB: Track[];
  labelColor?: string;
}

export interface DeckState {
  transport: Transport;
  trayOpen: boolean;
  recCoverOpen: boolean;
  dolby: boolean;
  tapeType: TapeType;
  limiter: boolean;
  quartz: boolean;
  light: boolean;
  memory: boolean;
  memoryAt: number;
  /** Seconds into the current side. */
  position: number;
  side: Side;
  currentTapeId: string | null;
  tapes: Tape[];
  ready: boolean;
  status: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();

export const state: DeckState = {
  transport: "stop",
  trayOpen: false,
  recCoverOpen: false,
  dolby: false,
  tapeType: "normal",
  limiter: false,
  quartz: true,
  light: true,
  memory: false,
  memoryAt: 0,
  position: 0,
  side: "A",
  currentTapeId: null,
  tapes: [],
  ready: false,
  status: "Threading tape…",
};

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function patch(partial: Partial<DeckState>): void {
  Object.assign(state, partial);
  for (const fn of listeners) fn();
}

export function currentTape(): Tape | null {
  return state.tapes.find((t) => t.id === state.currentTapeId) ?? null;
}

export function currentTracks(): Track[] {
  const tape = currentTape();
  if (!tape) return [];
  return state.side === "A" ? tape.sideA : tape.sideB;
}

export function sideDuration(): number {
  return currentTracks().reduce((sum, t) => sum + t.duration, 0);
}

export function trackAt(position: number): { track: Track; index: number; offset: number } | null {
  const tracks = currentTracks();
  let cursor = 0;
  for (let i = 0; i < tracks.length; i++) {
    const next = cursor + tracks[i].duration;
    if (position < next || i === tracks.length - 1) {
      return { track: tracks[i], index: i, offset: Math.max(0, position - cursor) };
    }
    cursor = next;
  }
  return null;
}
