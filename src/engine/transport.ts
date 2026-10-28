import { currentTape, currentTracks, patch, sideDuration, state, trackAt } from "../state";
import { applyDeckTone, getContext, sourceInput, unlock, wowDepth } from "./audio";
import { startMotor, stopMotor, thunk } from "./sounds";

let playing: AudioBufferSourceNode | null = null;
let startedAt = 0;
let startedPos = 0;
let rate = 1;
let raf = 0;
let onFrame: ((dt: number) => void) | null = null;

export function setFrame(fn: (dt: number) => void): void {
  onFrame = fn;
}

function connectSource(src: AudioBufferSourceNode): void {
  const wow = wowDepth();
  src.detune.value = 0;
  try {
    wow.connect(src.detune);
  } catch {
    /* already */
  }
  src.connect(sourceInput());
}

function stopSource(): void {
  if (playing) {
    try {
      playing.stop();
      playing.disconnect();
    } catch {
      /* already stopped */
    }
    playing = null;
  }
}

function syncPositionFromClock(): void {
  if (!playing || (state.transport !== "play" && state.transport !== "rec")) return;
  const elapsed = (getContext().currentTime - startedAt) * rate;
  state.position = Math.min(sideDuration(), startedPos + elapsed);
}

export async function playFrom(position = state.position): Promise<void> {
  await unlock();
  stopSource();
  const hit = trackAt(position);
  const tape = currentTape();
  if (!tape || tape.kind === "blank" || !hit || !hit.track.buffer) {
    patch({ transport: "stop" });
    return;
  }
  const c = getContext();
  const src = c.createBufferSource();
  src.buffer = hit.track.buffer;
  rate = 1;
  src.playbackRate.value = 1;
  connectSource(src);
  startedAt = c.currentTime;
  startedPos = position;
  const remain = Math.max(0.05, hit.track.duration - hit.offset);
  src.onended = () => {
    if (state.transport !== "play") return;
    const nextPos = position - hit.offset + hit.track.duration + 0.01;
    if (nextPos >= sideDuration() - 0.05) {
      stopAll(true);
    } else {
      void playFrom(nextPos);
    }
  };
  src.start(0, hit.offset, remain);
  playing = src;
  patch({ transport: "play", position });
  applyDeckTone();
  updateMediaSession();
}

export function pause(): void {
  syncPositionFromClock();
  stopSource();
  patch({ transport: "pause" });
  applyDeckTone();
  updateMediaSession();
}

export function stopAll(auto = false): void {
  stopSource();
  stopMotor();
  if (auto) thunk();
  patch({ transport: "stop" });
  applyDeckTone();
  updateMediaSession();
}

export async function wind(dir: "ff" | "rew"): Promise<void> {
  await unlock();
  syncPositionFromClock();
  stopSource();
  await startMotor(dir === "ff" ? 1.4 : 0.85);
  patch({ transport: dir });
  applyDeckTone();
}

export function tickWind(dt: number): void {
  const dur = sideDuration();
  if (dur <= 0) return;
  const speed = 18; // seconds of tape per real second
  let pos = state.position;
  if (state.transport === "ff") pos += dt * speed;
  if (state.transport === "rew") pos -= dt * speed;
  if (pos <= 0) {
    state.position = 0;
    stopAll(true);
  } else if (pos >= dur) {
    state.position = dur;
    stopAll(true);
  } else {
    state.position = pos;
  }
}

export function skip(dir: -1 | 1): void {
  const tracks = currentTracks();
  if (!tracks.length) return;
  syncPositionFromClock();
  const hit = trackAt(state.position);
  if (!hit) return;
  let idx = hit.index + dir;
  if (idx < 0) {
    patch({ position: 0 });
  } else if (idx >= tracks.length) {
    stopAll(true);
    patch({ position: sideDuration() });
    return;
  } else {
    let pos = 0;
    for (let i = 0; i < idx; i++) pos += tracks[i].duration;
    patch({ position: pos });
  }
  if (state.transport === "play") void playFrom(state.position);
}

export function flipSide(): void {
  stopAll();
  patch({ side: state.side === "A" ? "B" : "A", position: 0 });
  updateMediaSession();
}

export function insertTape(id: string): void {
  stopAll();
  patch({ currentTapeId: id, position: 0, side: "A", trayOpen: false });
  updateMediaSession();
}

function loop(now: number): void {
  const last = (loop as unknown as { t?: number }).t ?? now;
  (loop as unknown as { t?: number }).t = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  if (state.transport === "play" || state.transport === "rec") syncPositionFromClock();
  if (state.transport === "ff" || state.transport === "rew") tickWind(dt);
  onFrame?.(dt);
  raf = requestAnimationFrame(loop);
}

export function startLoop(): void {
  if (!raf) raf = requestAnimationFrame(loop);
}

function updateMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const tape = currentTape();
  const hit = trackAt(state.position);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: hit?.track.title ?? tape?.title ?? "Side B",
    artist: tape?.title ?? "Side B",
    album: `Side ${state.side}`,
  });
  navigator.mediaSession.playbackState =
    state.transport === "play" || state.transport === "rec" ? "playing" : "paused";
}

export function bindMediaSession(handlers: {
  play: () => void;
  pause: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
}): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("play", handlers.play);
  navigator.mediaSession.setActionHandler("pause", handlers.pause);
  navigator.mediaSession.setActionHandler("stop", handlers.stop);
  navigator.mediaSession.setActionHandler("nexttrack", handlers.next);
  navigator.mediaSession.setActionHandler("previoustrack", handlers.prev);
}
