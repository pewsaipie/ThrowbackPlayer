import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/caveat/500.css";
import "@fontsource/share-tech-mono/400.css";
import "./styles.css";

import { applyDeckTone, decode, unlock, vuLevels } from "./engine/audio";
import { makeBlank, makeDemoTape } from "./engine/demo";
import { startRecording, stopRecording } from "./engine/recorder";
import { click, clunk, coverFlip, thunk } from "./engine/sounds";
import {
  bindMediaSession,
  flipSide,
  insertTape,
  pause,
  playFrom,
  setFrame,
  skip,
  startLoop,
  stopAll,
  wind,
} from "./engine/transport";
import {
  currentTape,
  currentTracks,
  patch,
  state,
  subscribe,
  trackAt,
  type TapeType,
} from "./state";
import { drawReels } from "./ui/reels";
import { drawVu } from "./ui/vu";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const door = $<HTMLButtonElement>("door");
const cassette = $("cassette");
const label = $<HTMLInputElement>("label");
const reels = $<HTMLCanvasElement>("reels");
const vuL = $<HTMLCanvasElement>("vuL");
const vuR = $<HTMLCanvasElement>("vuR");
const recLed = $("recLed");
const counter = $("counter");
const tray = $("tray");
const tapeList = $("tapeList");
const live = $("live");
const deckEl = $("deck");
const sideBadge = $("sideBadge");
const recCover = $<HTMLButtonElement>("recCover");
const recBtn = $<HTMLButtonElement>("rec");
const playBtn = $<HTMLButtonElement>("play");
const pauseBtn = $<HTMLButtonElement>("pause");
const stopBtn = $<HTMLButtonElement>("stop");
const rewBtn = $<HTMLButtonElement>("rew");
const ffBtn = $<HTMLButtonElement>("ff");
const file = $<HTMLInputElement>("file");

const TYPES: TapeType[] = ["normal", "cro2", "metal"];

function buzz(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptic */
  }
}

function announce(text: string): void {
  live.textContent = text;
}

function latch(): void {
  for (const [el, on] of [
    [playBtn, state.transport === "play" || state.transport === "rec"],
    [pauseBtn, state.transport === "pause"],
    [stopBtn, state.transport === "stop"],
    [rewBtn, state.transport === "rew"],
    [ffBtn, state.transport === "ff"],
    [recBtn, state.transport === "rec"],
  ] as const) {
    el.classList.toggle("latched", on);
  }
  recLed.classList.toggle("on", state.transport === "rec");
  recLed.classList.toggle("blink", state.transport === "pause");
  recCover.classList.toggle("open", state.recCoverOpen);
  recBtn.disabled = !state.recCoverOpen;
  tray.hidden = !state.trayOpen;
  deckEl.dataset.light = state.light ? "on" : "off";
  sideBadge.textContent = state.side;
}

function renderCounter(): void {
  const n = Math.min(9999, Math.max(0, Math.floor(state.position * 3)));
  const s = n.toString().padStart(4, "0");
  const spans = counter.querySelectorAll("span");
  spans.forEach((el, i) => {
    el.textContent = s[i] ?? "0";
  });
}

function renderTray(): void {
  tapeList.innerHTML = "";
  for (const tape of state.tapes) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = tape.id === state.currentTapeId ? "active" : "";
    const dur = [...tape.sideA, ...tape.sideB].reduce((a, t) => a + t.duration, 0);
    btn.innerHTML = `${escapeHtml(tape.title)}<small>${tape.kind.toUpperCase()} · ${Math.round(dur)}s · A/${tape.sideA.length} B/${tape.sideB.length}</small>`;
    btn.addEventListener("click", async () => {
      await clunk();
      insertTape(tape.id);
      announce(`Loaded ${tape.title}`);
    });
    li.append(btn);
    tapeList.append(li);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function paintLabel(): void {
  const tape = currentTape();
  const hit = trackAt(state.position);
  if (document.activeElement === label) return;
  if (!tape) {
    label.value = "No tape";
    return;
  }
  if (tape.kind === "blank") {
    label.value = "Blank C-60";
    return;
  }
  label.value = hit?.track.title ?? tape.title;
}

function render(): void {
  latch();
  renderCounter();
  paintLabel();
  renderTray();
  const hit = trackAt(state.position);
  const tape = currentTape();
  const line = tape
    ? `${tape.title} · Side ${state.side}${hit ? ` · ${hit.track.title}` : ""}`
    : "No tape";
  if (state.status !== line && state.ready) patch({ status: line });
}

subscribe(render);

setFrame(() => {
  drawReels(reels);
  const vu = vuLevels();
  const recBoost = state.transport === "rec" ? 0.35 : 0;
  drawVu(vuL, vu.l + recBoost, "l");
  drawVu(vuR, vu.r + recBoost, "r");
  renderCounter();
  if (document.activeElement !== label) paintLabel();
});

async function onPlay(): Promise<void> {
  await click(true);
  buzz(16);
  if (state.trayOpen) patch({ trayOpen: false });
  if (state.transport === "play") return;
  if (state.transport === "pause") {
    await playFrom(state.position);
    return;
  }
  await playFrom(state.position);
  announce(currentTracks().length ? "Play" : "No tape");
}

async function onPause(): Promise<void> {
  await click();
  buzz();
  if (state.transport === "play" || state.transport === "rec") {
    if (state.transport === "rec") await stopRecording();
    pause();
    announce("Pause");
  }
}

async function onStop(): Promise<void> {
  await click(true);
  buzz(18);
  const wasStopped = state.transport === "stop";
  if (state.transport === "rec") await stopRecording();
  else stopAll();
  if (wasStopped) {
    await clunk();
    patch({ trayOpen: true });
    announce("Eject");
  } else {
    thunk();
    announce("Stop");
  }
}

function bindWind(btn: HTMLButtonElement, dir: "ff" | "rew"): void {
  let timer = 0;
  let held = false;
  const start = async (e: PointerEvent) => {
    e.preventDefault();
    held = false;
    timer = window.setTimeout(async () => {
      held = true;
      await click();
      buzz(20);
      await wind(dir);
    }, 220);
  };
  const end = async () => {
    clearTimeout(timer);
    if (held) {
      if (state.transport === dir) {
        stopAll();
        thunk();
      }
      return;
    }
    await click();
    buzz();
    if (dir === "rew" && state.memory && state.transport === "stop") {
      patch({ position: state.memoryAt });
      announce("Memory");
      return;
    }
    skip(dir === "ff" ? 1 : -1);
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointercancel", end);
  btn.addEventListener("pointerleave", () => clearTimeout(timer));
}

door.addEventListener("click", async (e) => {
  if ((e.target as HTMLElement).closest(".label")) return;
  await clunk();
  buzz(20);
  if (!state.trayOpen) stopAll();
  patch({ trayOpen: !state.trayOpen });
});

sideBadge.addEventListener("click", async (e) => {
  e.stopPropagation();
  await click();
  flipSide();
  announce(`Side ${state.side}`);
});

label.addEventListener("click", (e) => e.stopPropagation());
label.addEventListener("change", () => {
  const tape = currentTape();
  if (!tape) return;
  tape.title = label.value.trim() || tape.title;
  patch({ tapes: [...state.tapes] });
});

$<HTMLButtonElement>("closeTray").addEventListener("click", async () => {
  await clunk();
  patch({ trayOpen: false });
});

$<HTMLButtonElement>("light").addEventListener("click", async (e) => {
  await click();
  const on = !state.light;
  (e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ light: on });
});

$<HTMLButtonElement>("dolby").addEventListener("click", async (e) => {
  await click();
  const on = !state.dolby;
  (e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ dolby: on });
  applyDeckTone();
});

$<HTMLButtonElement>("limiter").addEventListener("click", async (e) => {
  await click();
  const on = !state.limiter;
  (e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ limiter: on });
  applyDeckTone();
});

$<HTMLButtonElement>("quartz").addEventListener("click", async (e) => {
  await click();
  const on = !state.quartz;
  (e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ quartz: on });
  applyDeckTone();
});

$<HTMLButtonElement>("memory").addEventListener("click", async (e) => {
  await click();
  const on = !state.memory;
  (e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ memory: on, memoryAt: on ? state.position : 0 });
});

$<HTMLButtonElement>("tapeType").addEventListener("click", async (e) => {
  await click();
  const i = (TYPES.indexOf(state.tapeType) + 1) % TYPES.length;
  (e.currentTarget as HTMLButtonElement).dataset.pos = String(i);
  patch({ tapeType: TYPES[i] });
  applyDeckTone();
  announce(TYPES[i]);
});

$<HTMLButtonElement>("battery").addEventListener("click", async () => {
  await click(true);
  announce("You're on a phone.");
});

recCover.addEventListener("click", async () => {
  await coverFlip();
  patch({ recCoverOpen: !state.recCoverOpen });
});

recBtn.addEventListener("click", async () => {
  if (recBtn.disabled) return;
  await click(true);
  buzz(24);
  if (state.transport === "rec") {
    await stopRecording();
    announce("Take saved");
    return;
  }
  const ok = await startRecording();
  announce(ok ? "Recording" : "Mic blocked");
});

playBtn.addEventListener("click", () => void onPlay());
pauseBtn.addEventListener("click", () => void onPause());
stopBtn.addEventListener("click", () => void onStop());
bindWind(rewBtn, "rew");
bindWind(ffBtn, "ff");

file.addEventListener("change", async () => {
  const f = file.files?.[0];
  file.value = "";
  if (!f) return;
  try {
    await unlock();
    const buf = await decode(await f.arrayBuffer());
    const title = f.name.replace(/\.[^.]+$/, "");
    const id = `user-${Date.now()}`;
    const tape = {
      id,
      title,
      kind: "user" as const,
      sideA: [{ title, duration: buf.duration, buffer: buf }],
      sideB: [],
    };
    await clunk();
    patch({ tapes: [...state.tapes, tape] });
    insertTape(id);
    announce(`Loaded ${title}`);
  } catch {
    announce("Could not decode that file");
  }
});

door.addEventListener("keydown", (e) => {
  if (e.target === label || e.target === sideBadge) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    door.click();
  }
});

sideBadge.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    sideBadge.click();
  }
});

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, button, [role='button']")) return;
  if (e.code === "Space") {
    e.preventDefault();
    void onPlay();
  } else if (e.code === "KeyP") void onPause();
  else if (e.code === "KeyS") void onStop();
  else if (e.code === "ArrowRight") skip(1);
  else if (e.code === "ArrowLeft") skip(-1);
  else if (e.code === "KeyF") void flipSide();
});

bindMediaSession({
  play: () => void onPlay(),
  pause: () => void onPause(),
  stop: () => void onStop(),
  next: () => skip(1),
  prev: () => skip(-1),
});

async function boot(): Promise<void> {
  startLoop();
  render();
  try {
    const demo = await makeDemoTape();
    const blank = makeBlank();
    patch({
      tapes: [demo, blank],
      currentTapeId: demo.id,
      ready: true,
      status: demo.title,
    });
    cassette.style.opacity = "1";
    announce("Field Notes loaded. Press Play.");
  } catch (err) {
    patch({ ready: true, status: "Deck ready — insert a tape" });
    console.error(err);
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

void boot();
