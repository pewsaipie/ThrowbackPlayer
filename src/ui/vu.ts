import { state } from "../state";

let needleL = 0;
let needleR = 0;

export function drawVu(canvas: HTMLCanvasElement, level: number, which: "l" | "r"): void {
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

  const lit = state.light;
  ctx.fillStyle = lit ? "#e8d9b0" : "#7a6d52";
  ctx.fillRect(0, 0, w, h);

  // scale
  ctx.strokeStyle = lit ? "#2a2418" : "#1a160f";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1;
  const cx = w / 2;
  const cy = h * 0.95;
  const r = w * 0.62;
  ctx.font = `${Math.max(8, w * 0.065)}px "Share Tech Mono", monospace`;
  ctx.textAlign = "center";
  const marks = [-20, -10, -7, -5, -3, 0, 3];
  for (const db of marks) {
    const t = (db + 20) / 23;
    const a = Math.PI * (0.82 + t * 0.36);
    const x1 = cx + Math.cos(a) * r * 0.72;
    const y1 = cy - Math.sin(a) * r * 0.72;
    const x2 = cx + Math.cos(a) * r * 0.82;
    const y2 = cy - Math.sin(a) * r * 0.82;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = db > 0 ? "#b42222" : ctx.strokeStyle as string;
    ctx.fillText(String(db), cx + Math.cos(a) * r * 0.58, cy - Math.sin(a) * r * 0.58 + 3);
  }

  ctx.fillStyle = "#b42222";
  ctx.font = `${Math.max(7, w * 0.055)}px "Barlow Condensed", sans-serif`;
  ctx.fillText("PEAK", w * 0.82, h * 0.28);

  const target = Math.min(1, Math.max(0, level));
  if (which === "l") needleL += (target - needleL) * 0.22;
  else needleR += (target - needleR) * 0.22;
  const n = which === "l" ? needleL : needleR;
  const a = Math.PI * (0.82 + n * 0.36);

  ctx.strokeStyle = "#1a120c";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy - Math.sin(a) * r * 0.78);
  ctx.stroke();

  ctx.fillStyle = "#3a2a1a";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  // glass
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0.22)");
  g.addColorStop(0.4, "rgba(255,255,255,0.02)");
  g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (!lit) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, h);
  }
}
