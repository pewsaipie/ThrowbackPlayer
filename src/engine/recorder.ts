import { patch, state, type Side, type Tape, type Track } from "../state";
import { attachMic, decode, detachMic, getContext } from "./audio";
import { saveTape } from "./library";

let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let recordingStartedAt = 0;
let targetTapeId: string | null = null;
let targetSide: Side = "A";
let recordingRequest = 0;
let permissionPending = false;
let finalizing = false;
let finalization: Promise<boolean> | null = null;

export async function startRecording(tapeId: string, side: Side): Promise<boolean> {
  const tape = state.tapes.find((item) => item.id === tapeId);
  if (!tape || (tape.kind !== "blank" && tape.kind !== "take")) {
    patch({ status: "Insert a blank cassette to record" });
    return false;
  }
  if (permissionPending || finalizing) return false;

  const request = ++recordingRequest;
  targetTapeId = tapeId;
  targetSide = side;
  permissionPending = true;
  patch({ transport: "rec", status: "Requesting microphone" });

  try {
    const stream = await attachMic();
    if (request !== recordingRequest) {
      permissionPending = false;
      detachMic();
      return false;
    }
    permissionPending = false;
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start(200);
    recordingStartedAt = getContext().currentTime;
    patch({ transport: "rec", status: "Recording to cassette" });
    return true;
  } catch {
    if (request === recordingRequest) {
      permissionPending = false;
      targetTapeId = null;
      detachMic();
      patch({ transport: "stop", status: "Microphone unavailable", recCoverOpen: true });
    } else {
      permissionPending = false;
      detachMic();
    }
    return false;
  }
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "webm";
}

function makeRecordedTape(tape: Tape, side: Side, track: Track): { tape: Tape; position: number } {
  const existing = side === "A" ? tape.sideA : tape.sideB;
  const position = existing.reduce((total, item) => total + item.duration, 0);
  const title = tape.kind === "blank" && tape.title === "Blank C-60" ? "Recorded C-60" : tape.title;
  const base = { ...tape, title, kind: "take" as const };
  const updated = side === "A"
    ? { ...base, sideA: [...tape.sideA, track] }
    : { ...base, sideB: [...tape.sideB, track] };
  return { tape: updated, position };
}

export function stopRecording(): Promise<boolean> {
  if (finalization) return finalization;
  finalization = finishRecording().finally(() => {
    finalization = null;
  });
  return finalization;
}

async function finishRecording(): Promise<boolean> {
  const activeRecorder = recorder;
  recorder = null;
  const savedTapeId = targetTapeId;
  const savedSide = targetSide;
  targetTapeId = null;

  if (!activeRecorder) {
    if (permissionPending || state.transport === "rec") {
      recordingRequest++;
      detachMic();
      patch({ transport: "stop", recCoverOpen: false, status: "Recording cancelled" });
    }
    return false;
  }

  finalizing = true;
  patch({ recCoverOpen: false, status: "Saving recording" });
  try {
    const blob = await new Promise<Blob>((resolve) => {
      activeRecorder.onstop = () => resolve(new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" }));
      if (activeRecorder.state !== "inactive") activeRecorder.stop();
      else resolve(new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" }));
    });
    detachMic();

    const target = state.tapes.find((tape) => tape.id === savedTapeId);
    if (!target) {
      patch({ status: "Recording cancelled" });
      return false;
    }

    const fallbackDuration = Math.max(0.2, getContext().currentTime - recordingStartedAt);
    let buffer: AudioBuffer | null = null;
    try {
      buffer = await decode(await blob.arrayBuffer());
    } catch {
      // Preserve the original recording so it can still be exported if decoding is unavailable.
    }
    const tracks = savedSide === "A" ? target.sideA : target.sideB;
    const trackNumber = tracks.length + 1;
    const title = `Take ${trackNumber}`;
    const extension = extensionForMime(blob.type);
    const track: Track = {
      title,
      duration: buffer?.duration || fallbackDuration,
      buffer,
      blob,
      fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.${extension}`,
      mimeType: blob.type || "audio/webm",
    };
    const { tape, position } = makeRecordedTape(target, savedSide, track);
    patch({
      tapes: state.tapes.map((item) => item.id === tape.id ? tape : item),
      currentTapeId: tape.id,
      side: savedSide,
      position,
      transport: "stop",
      recCoverOpen: false,
      status: title,
    });

    try {
      await saveTape(tape);
      return true;
    } catch {
      return false;
    }
  } finally {
    finalizing = false;
  }
}
