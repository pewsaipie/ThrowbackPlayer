import { currentTape, currentTracks, patch, sideDuration, state, trackAt } from "../state";
import { applyDeckTone, decode, getContext, sourceInput, unlock, wowDepth } from "./audio";
import { startMotor, stopMotor, thunk } from "./sounds";

let playing: AudioBufferSourceNode | null = null;
let playRequest = 0;
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
    /* already connected */
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

function stopAtMemory(): void {
  stopAll(true);
  window.dispatchEvent(new Event("memory-stop"));
}

function syncPositionFromClock(): boolean {
  if (!playing || (state.transport !== "play" && state.transport !== "rec")) return false;
  const elapsed = (getContext().currentTime - startedAt) * rate;
  const nextPosition = Math.min(sideDuration(), startedPos + elapsed);
  if (
    state.transport === "play" &&
    state.memory &&
    state.memoryAt > startedPos + 0.01 &&
    nextPosition >= state.memoryAt
  ) {
    state.position = state.memoryAt;
    stopAtMemory();
    return true;
  }
  state.position = nextPosition;
  return false;
}

export async function playFrom(position = state.position): Promise<void> {
  const request = ++playRequest;
  stopSource();
  stopMotor();
  patch({ transport: "play", position });
  await unlock();
  if (request !== playRequest) return;

  const tape = currentTape();
  const side = state.side;
  const hit = trackAt(position);
  if (!tape || !hit) {
    patch({ transport: "stop" });
    return;
  }

  let buffer = hit.track.buffer;
  if (!buffer && hit.track.blob) {
    try {
      buffer = await decode(await hit.track.blob.arrayBuffer());
    } catch {
      if (request === playRequest) patch({ transport: "stop" });
      return;
    }
    if (request !== playRequest) return;
    const activeTrack = currentTracks()[hit.index];
    if (currentTape()?.id !== tape.id || state.side !== side || activeTrack?.blob !== hit.track.blob) return;
    activeTrack.buffer = buffer;
  }
  if (!buffer) {
    if (request === playRequest) patch({ transport: "stop" });
    return;
  }

  const c = getContext();
  const src = c.createBufferSource();
  src.buffer = buffer;
  rate = 1;
  src.playbackRate.value = 1;
  connectSource(src);
  startedAt = c.currentTime;
  startedPos = position;
  const remain = Math.max(0.05, hit.track.duration - hit.offset);
  src.onended = () => {
    if (state.transport !== "play" || playing !== src) return;
    syncPositionFromClock();
    if (state.transport !== "play" || playing !== src) return;
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
  if (syncPositionFromClock()) return;
  playRequest++;
  stopSource();
  patch({ transport: "pause" });
  applyDeckTone();
  updateMediaSession();
}

export function stopAll(auto = false): void {
  playRequest++;
  stopSource();
  stopMotor();
  if (auto) thunk();
  patch({ transport: "stop" });
  applyDeckTone();
  updateMediaSession();
}

export async function seek(position: number): Promise<void> {
  if (state.transport === "rec") return;
  const wasPlaying = state.transport === "play";
  if (wasPlaying) syncPositionFromClock();
  const resume = wasPlaying && state.transport === "play";
  const wasWinding = state.transport === "ff" || state.transport === "rew";
  playRequest++;
  stopSource();
  stopMotor();
  const target = Math.max(0, Math.min(sideDuration(), Number.isFinite(position) ? position : 0));
  const transport = resume ? "pause" : wasWinding ? "stop" : state.transport;
  patch({ position: target, transport });
  if (resume) await playFrom(target);
  else {
    applyDeckTone();
    updateMediaSession();
  }
}

export async function wind(dir: "ff" | "rew"): Promise<void> {
  if (state.transport === "rec") return;
  await unlock();
  if (syncPositionFromClock()) return;
  playRequest++;
  stopSource();
  await startMotor(dir === "ff" ? 1.4 : 0.85);
  patch({ transport: dir });
  applyDeckTone();
}

export function tickWind(dt: number): void {
  const dur = sideDuration();
  if (dur <= 0) return;
  const previous = state.position;
  const speed = 18; // seconds of tape per real second
  let position = previous;
  if (state.transport === "ff") position += dt * speed;
  if (state.transport === "rew") position -= dt * speed;

  if (state.memory) {
    const crossesMemory =
      (state.transport === "ff" && state.memoryAt > previous && state.memoryAt <= position) ||
      (state.transport === "rew" && state.memoryAt < previous && state.memoryAt >= position);
    if (crossesMemory) {
      state.position = state.memoryAt;
      stopAtMemory();
      return;
    }
  }

  if (position <= 0) {
    state.position = 0;
    stopAll(true);
  } else if (position >= dur) {
    state.position = dur;
    stopAll(true);
  } else {
    state.position = position;
  }
}

export function skip(dir: -1 | 1): void {
  if (state.transport === "rec") return;
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
  if (state.transport === "rec") return;
  stopAll();
  patch({ side: state.side === "A" ? "B" : "A", position: 0, memory: false, memoryAt: 0 });
  updateMediaSession();
}

export function insertTape(id: string): void {
  if (state.transport === "rec") return;
  stopAll();
  patch({ currentTapeId: id, position: 0, side: "A", trayOpen: false, memory: false, memoryAt: 0 });
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
    title: hit?.track.title ?? tape?.title ?? `Side ${state.side}`,
    artist: tape?.title ?? "Field recording",
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
