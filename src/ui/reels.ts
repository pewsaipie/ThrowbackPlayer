import { currentTape, sideDuration, state } from "../state";

export function drawReels(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const tape = currentTape();
  const dur = Math.max(0.001, sideDuration());
  const p = tape && tape.kind !== "blank" ? Math.min(1, state.position / dur) : 0.5;

  const y = h * 0.58;
  const leftX = w * 0.28;
  const rightX = w * 0.72;
  const maxR = Math.min(w, h) * 0.22;
  const minR = maxR * 0.42;
  const leftR = maxR - (maxR - minR) * p;
  const rightR = minR + (maxR - minR) * p;

  const spinning =
    state.transport === "play" ||
    state.transport === "rec" ||
    state.transport === "ff" ||
    state.transport === "rew";
  const dir = state.transport === "rew" ? -1 : 1;
  const speed =
    state.transport === "ff" || state.transport === "rew" ? 14 : state.transport === "pause" ? 0 : 2.4;
  const t = spinning ? (performance.now() / 1000) * speed * dir : 0;

  drawPack(ctx, leftX, y, leftR, t / Math.max(0.25, leftR / maxR), "#6a3b24");
  drawPack(ctx, rightX, y, rightR, t / Math.max(0.25, rightR / maxR), "#6a3b24");
  drawHub(ctx, leftX, y, minR * 0.85, t / Math.max(0.25, leftR / maxR));
  drawHub(ctx, rightX, y, minR * 0.85, t / Math.max(0.25, rightR / maxR));

  // tape path
  ctx.strokeStyle = "rgba(80, 42, 24, 0.85)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(leftX + leftR, y);
  ctx.lineTo(rightX - rightR, y);
  ctx.stroke();
}

function drawPack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
  g.addColorStop(0, "#8a4d2e");
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.55 + i * 0.07), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  void rot;
}

function drawHub(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "#cfc8bf";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2b2b2b";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
