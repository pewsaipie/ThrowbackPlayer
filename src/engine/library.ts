import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Tape, Track } from "../state";

const DB_NAME = "throwback-player-library";
const DB_VERSION = 1;
const STORE_NAME = "tapes";
const BACKUP_FORMAT = "cassette-library-backup";
const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

type StoredKind = Exclude<Tape["kind"], "demo">;

interface StoredTrack {
  title: string;
  duration: number;
  blob: Blob;
  fileName?: string;
  mimeType?: string;
}

interface StoredTape {
  id: string;
  title: string;
  kind: StoredKind;
  sideA: StoredTrack[];
  sideB: StoredTrack[];
  updatedAt: number;
}

interface BackupTrack {
  title: string;
  duration: number;
  file: string;
  fileName?: string;
  mimeType?: string;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 1;
  title: string;
  kind: StoredKind;
  sideA: BackupTrack[];
  sideB: BackupTrack[];
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Local library storage is unavailable in this browser."));
  }

  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local library."));
    request.onblocked = () => reject(new Error("Local library upgrade is blocked by another open tab."));
  }).catch((error: unknown) => {
    database = null;
    throw error;
  });
  return database!;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local library transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local library transaction was cancelled."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local library request failed."));
  });
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = buffer.length * blockAlign;
  const array = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(array);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([array], { type: "audio/wav" });
}

function getTrackBlob(track: Track): Blob {
  if (track.blob) return track.blob;
  if (track.buffer) return audioBufferToWav(track.buffer);
  throw new Error(`Track “${track.title}” has no audio data to save.`);
}

function storedTrack(track: Track): StoredTrack {
  const blob = getTrackBlob(track);
  return {
    title: track.title,
    duration: track.duration,
    blob,
    ...(track.fileName ? { fileName: track.fileName } : {}),
    mimeType: track.mimeType || blob.type || "application/octet-stream",
  };
}

function hydrateTrack(track: StoredTrack): Track {
  return {
    title: track.title,
    duration: track.duration,
    buffer: null,
    blob: track.blob,
    ...(track.fileName ? { fileName: track.fileName } : {}),
    ...(track.mimeType ? { mimeType: track.mimeType } : {}),
  };
}

export async function loadLibrary(): Promise<Tape[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, "readonly");
  const done = transactionDone(tx);
  const records = await requestResult(tx.objectStore(STORE_NAME).getAll() as IDBRequest<StoredTape[]>);
  await done;
  records.sort((a, b) => a.updatedAt - b.updatedAt);

  return Promise.all(
    records.map(async (record) => ({
      id: record.id,
      title: record.title,
      kind: record.kind,
      sideA: await Promise.all(record.sideA.map(hydrateTrack)),
      sideB: await Promise.all(record.sideB.map(hydrateTrack)),
    })),
  );
}

export async function saveTape(tape: Tape): Promise<void> {
  if (tape.kind === "demo") return;
  const db = await openDatabase();
  const record: StoredTape = {
    id: tape.id,
    title: tape.title,
    kind: tape.kind,
    sideA: tape.sideA.map(storedTrack),
    sideB: tape.sideB.map(storedTrack),
    updatedAt: Date.now(),
  };
  const tx = db.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(STORE_NAME).put(record);
  await done;
}

export async function deleteTapeFromLibrary(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(STORE_NAME).delete(id);
  await done;
}

function cleanFileName(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "audio";
}

function extensionFor(track: Track, blob: Blob): string {
  const fromName = track.fileName?.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const mime = (track.mimeType || blob.type).toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("flac")) return "flac";
  return "webm";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function createTapeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export async function exportTapeArchive(tape: Tape): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const writeSide = async (tracks: Track[], side: "A" | "B"): Promise<BackupTrack[]> => {
    const manifestTracks: BackupTrack[] = [];
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index];
      const blob = getTrackBlob(track);
      const path = `audio/side-${side.toLowerCase()}/${String(index + 1).padStart(2, "0")}-${cleanFileName(track.title)}.${extensionFor(track, blob)}`;
      files[path] = new Uint8Array(await blob.arrayBuffer());
      manifestTracks.push({
        title: track.title,
        duration: track.duration,
        file: path,
        ...(track.fileName ? { fileName: track.fileName } : {}),
        mimeType: track.mimeType || blob.type || "application/octet-stream",
      });
    }
    return manifestTracks;
  };

  const [sideA, sideB] = await Promise.all([writeSide(tape.sideA, "A"), writeSide(tape.sideB, "B")]);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: 1,
    title: tape.title,
    kind: tape.kind === "demo" ? "user" : tape.kind,
    sideA,
    sideB,
  };
  files["tape.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 1 });
  return new Blob([toArrayBuffer(zipped)], { type: "application/zip" });
}

function readBackupSide(files: Record<string, Uint8Array>, tracks: BackupTrack[]): Promise<Track[]> {
  return Promise.all(
    tracks.map(async (metadata) => {
      if (!metadata.file.startsWith("audio/") || metadata.file.includes("..")) {
        throw new Error("Backup contains an invalid audio path.");
      }
      const bytes = files[metadata.file];
      if (!bytes) throw new Error(`Backup is missing ${metadata.file}.`);
      const blob = new Blob([toArrayBuffer(bytes)], { type: metadata.mimeType || "application/octet-stream" });
      return {
        title: metadata.title,
        duration: Number.isFinite(metadata.duration) ? Math.max(0, metadata.duration) : 0,
        buffer: null,
        blob,
        ...(metadata.fileName ? { fileName: metadata.fileName } : {}),
        ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
      };
    }),
  );
}

export async function importTapeArchive(file: Blob): Promise<Tape> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup is too large to import in this browser.");
  let expandedBytes = 0;
  let oversized = false;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      expandedBytes += entry.originalSize;
      if (entry.originalSize > MAX_BACKUP_BYTES || expandedBytes > MAX_BACKUP_BYTES) {
        oversized = true;
        return false;
      }
      return entry.name === "tape.json" || entry.name.startsWith("audio/");
    },
  });
  if (oversized) throw new Error("Backup expands beyond the local import limit.");
  const rawManifest = files["tape.json"];
  if (!rawManifest) throw new Error("This archive does not contain a tape backup.");
  const manifest = JSON.parse(strFromU8(rawManifest)) as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== 1 || !manifest.title) {
    throw new Error("This tape backup is not supported.");
  }
  const sideAInfo = Array.isArray(manifest.sideA) ? manifest.sideA : [];
  const sideBInfo = Array.isArray(manifest.sideB) ? manifest.sideB : [];
  if (sideAInfo.length + sideBInfo.length > 100) throw new Error("Backup contains too many tracks.");
  const [sideA, sideB] = await Promise.all([
    readBackupSide(files, sideAInfo),
    readBackupSide(files, sideBInfo),
  ]);
  const kind: StoredKind = manifest.kind === "take" || manifest.kind === "blank" ? manifest.kind : "user";
  return {
    id: createTapeId("import"),
    title: String(manifest.title).slice(0, 80),
    kind,
    sideA,
    sideB,
  };
}
