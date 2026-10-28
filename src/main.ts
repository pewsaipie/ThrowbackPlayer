import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/caveat/500.css";
import "@fontsource/share-tech-mono/400.css";
import "./styles.css";

import { applyDeckTone, decode, unlock, vuLevels } from "./engine/audio";
import { makeBlank, makeDemoTape } from "./engine/demo";
import { deleteTapeFromLibrary, createTapeId, exportTapeArchive, importTapeArchive, loadLibrary, saveTape } from "./engine/library";
import { startRecording, stopRecording } from "./engine/recorder";
import { click, clunk, coverFlip, thunk } from "./engine/sounds";
import {
  currentTape,
  currentTracks,
  patch,
  sideDuration,
  state,
  subscribe,
  trackAt,
  type Tape,
  type TapeType,
} from "./state";
import {
  bindMediaSession,
  flipSide,
  insertTape,
  pause,
  playFrom,
  seek as seekTo,
  setFrame,
  skip,
  startLoop,
  stopAll,
  wind,
} from "./engine/transport";
import { drawReels } from "./ui/reels";
import { drawVu } from "./ui/vu";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const door = $("door");
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
const sideBadge = $<HTMLButtonElement>("sideBadge");
const recCover = $<HTMLButtonElement>("recCover");
const recBtn = $<HTMLButtonElement>("rec");
const playBtn = $<HTMLButtonElement>("play");
const pauseBtn = $<HTMLButtonElement>("pause");
const stopBtn = $<HTMLButtonElement>("stop");
const rewBtn = $<HTMLButtonElement>("rew");
const ffBtn = $<HTMLButtonElement>("ff");
const file = $<HTMLInputElement>("file");
const seekBar = $<HTMLInputElement>("seek");
const positionTime = $<HTMLOutputElement>("positionTime");
const volumeSlider = $<HTMLInputElement>("volume");
const volumeValue = $<HTMLOutputElement>("volumeValue");
const libraryStatus = $<HTMLParagraphElement>("libraryStatus");
const updateBanner = $<HTMLDivElement>("updateBanner");
const updateButton = $<HTMLButtonElement>("updateApp");
const dismissUpdateButton = $<HTMLButtonElement>("dismissUpdate");
const checkUpdatesButton = $<HTMLButtonElement>("checkUpdates");

let appRegistration: ServiceWorkerRegistration | null = null;
let observedRegistration: ServiceWorkerRegistration | null = null;
let observedInstallingWorker: ServiceWorker | null = null;
let waitingWorker: ServiceWorker | null = null;
let applyingUpdate = false;

const TYPES: TapeType[] = ["normal", "type2", "metal"];

function buzz(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptic feedback available */
  }
}

function announce(text: string): void {
  live.textContent = text;
}

function showReadyUpdate(registration: ServiceWorkerRegistration): void {
  waitingWorker = registration.waiting;
  updateBanner.hidden = !waitingWorker;
  if (waitingWorker) announce("A new app version is ready to install");
}

function watchForAppUpdates(registration: ServiceWorkerRegistration): void {
  appRegistration = registration;
  showReadyUpdate(registration);
  if (observedRegistration === registration) return;
  observedRegistration = registration;
  const observeInstallingWorker = () => {
    const installing = registration.installing;
    if (!installing || observedInstallingWorker === installing) return;
    observedInstallingWorker = installing;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && registration.waiting) {
        showReadyUpdate(registration);
      }
    });
  };
  registration.addEventListener("updatefound", observeInstallingWorker);
  observeInstallingWorker();
}

async function checkForAppUpdates(): Promise<void> {
  checkUpdatesButton.disabled = true;
  const originalLabel = checkUpdatesButton.textContent;
  checkUpdatesButton.textContent = "Checking…";
  try {
    if (!("serviceWorker" in navigator)) {
      announce("App updates are not supported in this browser");
      return;
    }
    const registration = appRegistration ?? await navigator.serviceWorker.getRegistration();
    if (!registration) {
      announce("App update service is not available yet");
      return;
    }
    watchForAppUpdates(registration);
    if (registration.waiting) {
      showReadyUpdate(registration);
      return;
    }
    await registration.update();
    if (registration.waiting) {
      showReadyUpdate(registration);
    } else if (registration.installing) {
      announce("Checking for app updates…");
    } else {
      updateBanner.hidden = true;
      waitingWorker = null;
      announce("The app is up to date");
    }
  } catch (error) {
    console.warn("App update check failed", error);
    announce("Could not check for app updates. Try again when online.");
  } finally {
    checkUpdatesButton.disabled = false;
    checkUpdatesButton.textContent = originalLabel;
  }
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function tapeIsRecordable(tape: Tape | null): boolean {
  return tape?.kind === "blank" || tape?.kind === "take";
}

function latch(): void {
  for (const [element, on] of [
    [playBtn, state.transport === "play" || state.transport === "rec"],
    [pauseBtn, state.transport === "pause"],
    [stopBtn, state.transport === "stop"],
    [rewBtn, state.transport === "rew"],
    [ffBtn, state.transport === "ff"],
    [recBtn, state.transport === "rec"],
  ] as const) {
    element.classList.toggle("latched", on);
  }
  recLed.classList.toggle("on", state.transport === "rec");
  recLed.classList.toggle("blink", state.transport === "pause");
  recCover.classList.toggle("open", state.recCoverOpen);
  recBtn.disabled = !state.recCoverOpen || (!tapeIsRecordable(currentTape()) && state.transport !== "rec");
  for (const [id, pressed] of [
    ["light", state.light],
    ["hissReduction", state.hissReduction],
    ["limiter", state.limiter],
    ["speedStability", state.speedStable],
    ["memory", state.memory],
  ] as const) {
    $<HTMLButtonElement>(id).setAttribute("aria-pressed", String(pressed));
  }
  tray.hidden = !state.trayOpen;
  deckEl.dataset.light = state.light ? "on" : "off";
  sideBadge.textContent = state.side;
  sideBadge.setAttribute("aria-label", `Flip to side ${state.side === "A" ? "B" : "A"}`);
}

function renderCounter(): void {
  const n = Math.min(9999, Math.max(0, Math.floor(state.position * 3)));
  const digits = n.toString().padStart(4, "0");
  const spans = counter.querySelectorAll("span");
  spans.forEach((element, index) => {
    element.textContent = digits[index] ?? "0";
  });
}

function renderPlaybackControls(): void {
  const duration = sideDuration();
  seekBar.max = String(Math.max(duration, 0.1));
  seekBar.disabled = !state.ready || duration <= 0 || !currentTracks().some((track) => track.buffer || track.blob) || state.transport === "rec";
  if (document.activeElement !== seekBar) {
    seekBar.value = String(Math.min(state.position, duration));
    positionTime.textContent = `${formatTime(state.position)} / ${formatTime(duration)}`;
  }
  volumeSlider.value = String(state.volume);
  volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
}

function renderTray(): void {
  tapeList.replaceChildren();
  for (const tape of state.tapes) {
    const item = document.createElement("li");
    item.className = "tape-card";

    const select = document.createElement("button");
    select.type = "button";
    select.className = `tape-select${tape.id === state.currentTapeId ? " active" : ""}`;
    select.setAttribute("aria-current", tape.id === state.currentTapeId ? "true" : "false");
    const title = document.createElement("span");
    title.className = "tape-title";
    title.textContent = tape.title;
    const details = document.createElement("small");
    const duration = [...tape.sideA, ...tape.sideB].reduce((total, track) => total + track.duration, 0);
    details.textContent = `${tape.kind.toUpperCase()} · ${formatTime(duration)} · SIDE A ${tape.sideA.length} / SIDE B ${tape.sideB.length}`;
    select.append(title, details);
    select.addEventListener("click", async () => {
      if (state.transport === "rec") {
        announce("Stop recording before changing cassettes");
        return;
      }
      await clunk();
      insertTape(tape.id);
      announce(`Loaded ${tape.title}`);
    });
    item.append(select);

    if (tape.kind !== "demo") {
      const actions = document.createElement("div");
      actions.className = "tape-actions";
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "tape-action";
      exportButton.textContent = "Export ZIP";
      exportButton.disabled = state.transport === "rec" && tape.id === state.currentTapeId;
      exportButton.setAttribute("aria-label", `Export ${tape.title} as a ZIP backup`);
      exportButton.addEventListener("click", () => void downloadTape(tape));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "tape-action delete";
      deleteButton.textContent = "Delete";
      deleteButton.disabled = state.transport === "rec" && tape.id === state.currentTapeId;
      deleteButton.setAttribute("aria-label", `Delete ${tape.title}`);
      deleteButton.addEventListener("click", () => void removeTape(tape));
      actions.append(exportButton, deleteButton);
      item.append(actions);
    }
    tapeList.append(item);
  }
}

function paintLabel(): void {
  const tape = currentTape();
  label.value = tape?.title ?? "No cassette";
}

function render(): void {
  latch();
  renderCounter();
  renderPlaybackControls();
  paintLabel();
  renderTray();
  const hit = trackAt(state.position);
  const tape = currentTape();
  const line = tape
    ? `${tape.title} · Side ${state.side}${hit ? ` · ${hit.track.title}` : ""}`
    : "No cassette";
  if (state.status !== line && state.ready) patch({ status: line });
}

async function saveToLocalLibrary(tape: Tape): Promise<boolean> {
  try {
    await saveTape(tape);
    return true;
  } catch {
    return false;
  }
}

async function downloadTape(tape: Tape): Promise<void> {
  try {
    const archive = await exportTapeArchive(tape);
    const url = URL.createObjectURL(archive);
    const anchor = document.createElement("a");
    const fileName = tape.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "cassette";
    anchor.href = url;
    anchor.download = `${fileName}.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    announce(`Exported ${tape.title}`);
  } catch (error) {
    console.error(error);
    announce("Could not export this cassette");
  }
}

async function removeTape(tape: Tape): Promise<void> {
  if (tape.kind === "demo" || state.transport === "rec") return;
  if (!window.confirm(`Delete “${tape.title}” from this device?`)) return;
  let removedFromStorage = true;
  try {
    await deleteTapeFromLibrary(tape.id);
  } catch {
    removedFromStorage = false;
  }
  if (state.currentTapeId === tape.id) {
    stopAll();
    const demo = state.tapes.find((item) => item.kind === "demo");
    patch({ currentTapeId: demo?.id ?? null, position: 0, side: "A", memory: false, memoryAt: 0 });
  }
  patch({ tapes: state.tapes.filter((item) => item.id !== tape.id) });
  announce(removedFromStorage ? `Deleted ${tape.title}` : "Removed for this session; local storage could not be updated");
}

subscribe(render);
window.addEventListener("memory-stop", () => announce(`Memory stop at ${formatTime(state.memoryAt)}`));

setFrame(() => {
  drawReels(reels);
  const vu = vuLevels();
  const recordBoost = state.transport === "rec" ? 0.35 : 0;
  drawVu(vuL, vu.l + recordBoost, "l");
  drawVu(vuR, vu.r + recordBoost, "r");
  renderCounter();
  renderPlaybackControls();
});

async function onPlay(): Promise<void> {
  if (state.transport === "rec") {
    announce("Finish recording before playback");
    return;
  }
  await click(true);
  buzz(16);
  if (state.trayOpen) patch({ trayOpen: false });
  if (state.transport === "play") return;
  await playFrom(state.position);
  const transportAfterPlay: string = state.transport;
  announce(transportAfterPlay === "play" ? "Play" : currentTracks().length ? "Could not play this audio" : "No audio on this side");
}

async function onPause(): Promise<void> {
  await click();
  buzz();
  if (state.transport === "rec") {
    const saved = await stopRecording();
    announce(saved ? "Recording saved" : "Recording ended but could not be saved locally");
    return;
  }
  if (state.transport === "play") {
    pause();
    const transportAfterPause: string = state.transport;
    if (transportAfterPause === "pause") announce("Pause");
  }
}

async function onStop(): Promise<void> {
  await click(true);
  buzz(18);
  const wasStopped = state.transport === "stop";
  if (state.transport === "rec") {
    const saved = await stopRecording();
    announce(saved ? "Recording saved to cassette" : "Recording ended; local save failed");
  } else {
    stopAll();
    if (wasStopped) {
      await clunk();
      patch({ trayOpen: true });
      announce("Cassette tray open");
    } else {
      thunk();
      announce("Stop");
    }
  }
}

function bindWind(button: HTMLButtonElement, direction: "ff" | "rew"): void {
  let timer = 0;
  let held = false;
  const start = (event: PointerEvent) => {
    event.preventDefault();
    held = false;
    timer = window.setTimeout(async () => {
      if (state.transport === "rec") return;
      held = true;
      await click();
      buzz(20);
      await wind(direction);
    }, 220);
  };
  const end = async () => {
    window.clearTimeout(timer);
    if (held) {
      if (state.transport === direction) {
        stopAll();
        thunk();
      }
      return;
    }
    if (state.transport === "rec") return;
    await click();
    buzz();
    skip(direction === "ff" ? 1 : -1);
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("pointerleave", () => window.clearTimeout(timer));
}

door.addEventListener("click", async (event) => {
  if ((event.target as HTMLElement).closest(".label")) return;
  if (state.transport === "rec") {
    announce("Stop recording before opening the cassette tray");
    return;
  }
  await clunk();
  buzz(20);
  if (!state.trayOpen) stopAll();
  patch({ trayOpen: !state.trayOpen });
});

sideBadge.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (state.transport === "rec") {
    announce("Stop recording before changing cassette sides");
    return;
  }
  await click();
  flipSide();
  announce(`Side ${state.side}`);
});

label.addEventListener("click", (event) => event.stopPropagation());
label.addEventListener("change", () => {
  const tape = currentTape();
  if (!tape) return;
  const title = label.value.trim().slice(0, 80);
  if (title) tape.title = title;
  patch({ tapes: [...state.tapes] });
  void saveToLocalLibrary(tape).then((saved) => {
    announce(saved ? "Cassette label saved" : "Label changed for this session only");
  });
});

$<HTMLButtonElement>("closeTray").addEventListener("click", async () => {
  await clunk();
  patch({ trayOpen: false });
});

checkUpdatesButton.addEventListener("click", () => void checkForAppUpdates());
updateButton.addEventListener("click", () => {
  if (state.transport === "rec") {
    announce("Finish recording before updating the app");
    return;
  }
  const worker = appRegistration?.waiting ?? waitingWorker;
  if (!worker) {
    updateBanner.hidden = true;
    announce("No app update is ready yet");
    return;
  }
  applyingUpdate = true;
  announce("Applying app update…");
  worker.postMessage({ type: "ACTIVATE_UPDATE" });
});
dismissUpdateButton.addEventListener("click", () => {
  updateBanner.hidden = true;
  announce("Update postponed. Check again when you are ready.");
});

$<HTMLButtonElement>("newBlank").addEventListener("click", async () => {
  const tape = makeBlank(createTapeId("blank"));
  const saved = await saveToLocalLibrary(tape);
  patch({ tapes: [...state.tapes, tape] });
  insertTape(tape.id);
  announce(saved ? "Blank cassette created" : "Blank cassette created for this session only");
});

$<HTMLButtonElement>("light").addEventListener("click", async (event) => {
  await click();
  const on = !state.light;
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ light: on });
});

$<HTMLButtonElement>("hissReduction").addEventListener("click", async (event) => {
  await click();
  const on = !state.hissReduction;
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ hissReduction: on });
  applyDeckTone();
});

$<HTMLButtonElement>("limiter").addEventListener("click", async (event) => {
  await click();
  const on = !state.limiter;
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ limiter: on });
  applyDeckTone();
});

$<HTMLButtonElement>("speedStability").addEventListener("click", async (event) => {
  await click();
  const stable = !state.speedStable;
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(stable));
  patch({ speedStable: stable });
  applyDeckTone();
});

$<HTMLButtonElement>("memory").addEventListener("click", async (event) => {
  await click();
  if (state.transport === "rec") {
    announce("Finish recording before setting a memory stop");
    return;
  }
  const on = !state.memory;
  if (on && state.transport === "play") pause();
  else if (on && (state.transport === "ff" || state.transport === "rew")) stopAll();
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(on));
  patch({ memory: on, memoryAt: on ? state.position : 0 });
  announce(on ? `Memory stop set at ${formatTime(state.position)}` : "Memory stop disabled");
});

$<HTMLButtonElement>("tapeType").addEventListener("click", async (event) => {
  await click();
  const index = (TYPES.indexOf(state.tapeType) + 1) % TYPES.length;
  const type = TYPES[index];
  (event.currentTarget as HTMLButtonElement).dataset.pos = String(index);
  patch({ tapeType: type });
  applyDeckTone();
  announce(type === "type2" ? "Type II tape" : `${type} tape`);
});

$<HTMLButtonElement>("storageCheck").addEventListener("click", async () => {
  await click(true);
  try {
    const estimate = await navigator.storage?.estimate();
    if (!estimate?.quota) {
      announce("Storage usage estimate is unavailable");
      return;
    }
    const usedMb = ((estimate.usage ?? 0) / (1024 * 1024)).toFixed(1);
    const quotaMb = (estimate.quota / (1024 * 1024)).toFixed(0);
    announce(`Local storage: ${usedMb} of ${quotaMb} megabytes used`);
  } catch {
    announce("Storage usage estimate is unavailable");
  }
});

recCover.addEventListener("click", async () => {
  if (state.transport === "rec") {
    announce("Stop recording before closing the record cover");
    return;
  }
  await coverFlip();
  patch({ recCoverOpen: !state.recCoverOpen });
  if (!tapeIsRecordable(currentTape())) announce("Insert a blank or recorded cassette to record");
});

recBtn.addEventListener("click", async () => {
  if (recBtn.disabled) return;
  await click(true);
  buzz(24);
  if (state.transport === "rec") {
    const saved = await stopRecording();
    announce(saved ? "Recording saved to cassette" : "Recording ended; local save failed");
    return;
  }
  const tape = currentTape();
  if (!tape || !tapeIsRecordable(tape)) {
    announce("Insert a blank cassette to record");
    return;
  }
  const ok = await startRecording(tape.id, state.side);
  announce(ok ? `Recording on side ${state.side}` : "Microphone access was not available");
});

playBtn.addEventListener("click", () => void onPlay());
pauseBtn.addEventListener("click", () => void onPause());
stopBtn.addEventListener("click", () => void onStop());
bindWind(rewBtn, "rew");
bindWind(ffBtn, "ff");

seekBar.addEventListener("input", () => {
  const duration = sideDuration();
  positionTime.textContent = `${formatTime(Number(seekBar.value))} / ${formatTime(duration)}`;
});
seekBar.addEventListener("change", () => {
  void seekTo(Number(seekBar.value)).then(() => announce(`Position ${formatTime(state.position)}`));
});

volumeSlider.addEventListener("input", () => {
  const volume = Math.max(0, Math.min(1, Number(volumeSlider.value)));
  patch({ volume });
  applyDeckTone();
});

file.addEventListener("change", async () => {
  const selected = file.files?.[0];
  file.value = "";
  if (!selected) return;

  try {
    await unlock();
    let tape: Tape;
    if (selected.name.toLowerCase().endsWith(".zip")) {
      tape = await importTapeArchive(selected);
    } else {
      const buffer = await decode(await selected.arrayBuffer());
      const title = selected.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Imported audio";
      tape = {
        id: createTapeId("audio"),
        title,
        kind: "user",
        sideA: [{ title, duration: buffer.duration, buffer, blob: selected, fileName: selected.name, mimeType: selected.type }],
        sideB: [],
      };
    }
    const saved = await saveToLocalLibrary(tape);
    patch({ tapes: [...state.tapes, tape] });
    await clunk();
    insertTape(tape.id);
    announce(saved ? `Loaded and saved ${tape.title}` : `Loaded ${tape.title} for this session only`);
  } catch (error) {
    console.error(error);
    announce("Could not read that audio file or backup");
  }
});

door.addEventListener("keydown", (event) => {
  if (event.target === label || event.target === sideBadge) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    door.click();
  }
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, button, [role='button']")) return;
  if (event.code === "Space") {
    event.preventDefault();
    void onPlay();
  } else if (event.code === "KeyP") void onPause();
  else if (event.code === "KeyS") void onStop();
  else if (event.code === "ArrowRight") skip(1);
  else if (event.code === "ArrowLeft") skip(-1);
  else if (event.code === "KeyF") void flipSide();
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
    const [demo, savedTapes] = await Promise.all([
      makeDemoTape(),
      loadLibrary().catch((error: unknown) => {
        console.warn("Local library unavailable", error);
        libraryStatus.textContent = "Local storage is unavailable; additions will last only for this session.";
        return [] as Tape[];
      }),
    ]);
    if (savedTapes.length > 0) {
      libraryStatus.textContent = "Saved tapes stay on this device. Export ZIP backups from the tray.";
    }
    patch({
      tapes: [demo, ...savedTapes],
      currentTapeId: demo.id,
      ready: true,
      status: demo.title,
    });
    cassette.style.opacity = "1";
    announce("Field Notes loaded. Press Play.");
  } catch (error) {
    patch({ ready: true, status: "Deck ready — insert a cassette" });
    libraryStatus.textContent = "Could not load the local library. You can still use the demo tape.";
    console.error(error);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applyingUpdate) window.location.reload();
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(watchForAppUpdates)
      .catch((error: unknown) => console.warn("Service worker registration failed", error));
  });
}

void boot();
