import { patch, state } from "../state";
import { attachMic, decode, detachMic, getContext } from "./audio";
import { playFrom, stopAll } from "./transport";

let rec: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let recStarted = 0;

export async function startRecording(): Promise<boolean> {
  try {
    const stream = await attachMic();
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.start(200);
    recStarted = getContext().currentTime;
    patch({ transport: "rec", status: "Recording" });
    return true;
  } catch {
    detachMic();
    patch({ status: "Mic blocked", recCoverOpen: true });
    return false;
  }
}

export async function stopRecording(): Promise<void> {
  const recorder = rec;
  rec = null;
  if (!recorder) {
    detachMic();
    stopAll();
    return;
  }
  const blob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    if (recorder.state !== "inactive") recorder.stop();
    else resolve(new Blob(chunks, { type: recorder.mimeType }));
  });
  detachMic();
  const dur = Math.max(0.2, getContext().currentTime - recStarted);
  try {
    const buf = await decode(await blob.arrayBuffer());
    const takeNum = state.tapes.filter((t) => t.kind === "take").length + 1;
    const title = `Take ${takeNum}`;
    const id = `take-${Date.now()}`;
    const tape = {
      id,
      title,
      kind: "take" as const,
      sideA: [{ title, duration: buf.duration || dur, buffer: buf }],
      sideB: [],
    };
    patch({
      tapes: [...state.tapes, tape],
      currentTapeId: id,
      position: 0,
      side: "A",
      transport: "stop",
      recCoverOpen: false,
      status: title,
    });
  } catch {
    patch({ transport: "stop", status: "Take failed", recCoverOpen: false });
  }
}

export async function togglePlay(): Promise<void> {
  if (state.transport === "rec") {
    await stopRecording();
    return;
  }
  if (state.transport === "play") {
    const { pause } = await import("./transport");
    pause();
  } else {
    await playFrom(state.position);
  }
}
