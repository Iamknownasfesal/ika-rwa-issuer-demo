"use client";

import { useEffect, useRef } from "react";

/**
 * Engraved line field: horizontal hairlines that bend around a guilloché
 * rosette, the pattern printed on treasury bills. The lens drifts toward the
 * pointer. Pure canvas, no assets.
 */
export function LineField({
  running = true,
  tone = "ink",
  ax = 0.66,
  ay = 0.5,
  interactive = true,
}: {
  running?: boolean;
  tone?: "ink" | "paper";
  ax?: number;
  ay?: number;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const rgb = tone === "ink" ? "17,17,16" : "250,250,247";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;
    const lens = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lens.tx = lens.x = w * ax;
      lens.ty = lens.y = h * ay;
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) return;
      // Follow the pointer loosely so the rosette stays near its anchor.
      lens.tx = w * ax + (e.clientX - r.left - w * ax) * 0.25;
      lens.ty = h * ay + (e.clientY - r.top - h * ay) * 0.25;
    };

    const rosette = (cx: number, cy: number, R: number, alpha: number) => {
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = `rgba(${rgb},${alpha})`;
      // Ring of offset circles: the classic banknote rosette.
      const n = 90;
      const rot = t * 0.05;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const a = rot + (k / n) * Math.PI * 2;
        const ox = cx + Math.cos(a) * R * 0.36;
        const oy = cy + Math.sin(a) * R * 0.36;
        ctx.moveTo(ox + R * 0.5, oy);
        ctx.arc(ox, oy, R * 0.5, 0, Math.PI * 2);
      }
      ctx.stroke();
      // Phase-shifted sine rings around it.
      ctx.strokeStyle = `rgba(${rgb},${alpha * 0.8})`;
      for (let p = 0; p < 10; p++) {
        const phase = (p / 10) * Math.PI * 2 - rot * 2;
        ctx.beginPath();
        for (let i = 0; i <= 720; i++) {
          const th = (i / 720) * Math.PI * 2;
          const r = R * (0.93 + 0.035 * Math.sin(36 * th + phase));
          const x = cx + Math.cos(th) * r;
          const y = cy + Math.sin(th) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Fine inner seal.
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2);
      ctx.moveTo(cx + R * 0.16, cy);
      ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
      ctx.stroke();
    };

    const draw = () => {
      lens.x += (lens.tx - lens.x) * 0.06;
      lens.y += (lens.ty - lens.y) * 0.06;
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.27;
      const outer = R * 1.7;
      const gap = 7;
      for (let y0 = gap / 2; y0 < h; y0 += gap) {
        ctx.beginPath();
        let lastX = -1;
        for (let x = 0; x <= w; x += 6) {
          let px = x;
          let py = y0 + Math.sin(x * 0.006 + t * 0.6 + y0 * 0.015) * 1.2;
          const dx = px - lens.x;
          const dy = py - lens.y;
          const d = Math.hypot(dx, dy);
          if (d < outer) {
            // Push points out of the rosette so every line wraps around it.
            const f = R + (d / outer) * (outer - R);
            const k = f / (d || 1);
            px = lens.x + dx * k;
            py = lens.y + dy * k;
          }
          // A line through the centre splits around the ring: never bridge the gap.
          if (x === 0 || Math.abs(px - lastX) > 40) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
          lastX = px;
        }
        const near = 1 - Math.min(1, Math.abs(y0 - lens.y) / (h * 0.9));
        ctx.strokeStyle = `rgba(${rgb},${0.09 + near * 0.22})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
      rosette(lens.x, lens.y, R, tone === "ink" ? 0.32 : 0.3);
    };

    const loop = () => {
      if (runningRef.current && !reduce) t += 0.016;
      draw();
      raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (interactive) window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [tone, ax, ay, interactive]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
