"use client";

import { useEffect, useRef } from "react";
import styles from "./wall.module.css";

type Tile = {
  /** Position as fractions of the canvas, so resizes never reshuffle. */
  x: number;
  y: number;
  /** Edge length in CSS pixels. */
  size: number;
  radius: number;
  color: string;
  alpha: number;
  /** Twinkle phase and speed. */
  phase: number;
  twinkle: number;
  /** Drift amplitude (px) and speed. */
  driftX: number;
  driftY: number;
  driftSpeed: number;
};

const NEAR_COLORS = ["#0088ff", "#55aaff", "#b3ddff"];
const FAR_COLORS = ["#0e2b52", "#123c73", "#17477f"];

/**
 * The wall's left panel: a navy field of slowly drifting, twinkling tiles in
 * the logo's proportions, denser toward the bottom, under a soft beam of
 * light from the top. Runs at ~24fps, pauses while the tab is hidden, and
 * renders a single static frame when reduced motion is preferred.
 */
export default function FogField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    // A fresh const takes the narrowed (non-null) type; the hoisted function
    // declarations below couldn't rely on narrowing of the original binding.
    const ctx = maybeCtx;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const FRAME_MS = 1000 / 24;
    const start = performance.now();
    const tiles = makeTiles();

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let running = false;

    function roundedRect(x: number, y: number, size: number, radius: number) {
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, radius);
        return;
      }
      ctx.beginPath();
      ctx.rect(x, y, size, size);
    }

    function draw(now: number) {
      const t = (now - start) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = "#0b1528";
      ctx.fillRect(0, 0, width, height);

      // A soft beam and glow falling from the top of the panel.
      const beam = ctx.createLinearGradient(0, 0, 0, height * 0.75);
      beam.addColorStop(0, "rgba(179, 221, 255, 0.14)");
      beam.addColorStop(1, "rgba(179, 221, 255, 0)");
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, width, height * 0.75);

      const glow = ctx.createRadialGradient(width * 0.5, -height * 0.1, 0, width * 0.5, -height * 0.1, height * 0.7);
      glow.addColorStop(0, "rgba(85, 170, 255, 0.18)");
      glow.addColorStop(1, "rgba(85, 170, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      for (const tile of tiles) {
        const x = tile.x * width + Math.sin(t * tile.driftSpeed + tile.phase) * tile.driftX;
        const y = tile.y * height + Math.cos(t * tile.driftSpeed * 0.8 + tile.phase * 1.7) * tile.driftY;
        const twinkle = 0.55 + 0.45 * Math.sin(t * tile.twinkle + tile.phase * 3);
        ctx.globalAlpha = tile.alpha * twinkle;
        ctx.fillStyle = tile.color;
        roundedRect(x, y, tile.size, tile.radius);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function tick(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    }

    function play() {
      if (running || reduced) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    }

    function pause() {
      running = false;
      cancelAnimationFrame(raf);
    }

    function onVisibilityChange() {
      if (document.hidden) pause();
      else play();
    }

    const observer = new ResizeObserver(() => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      // Repaint on resize even while paused or reduced, so the static frame
      // never stretches.
      if (!running) draw(start);
    });
    observer.observe(canvas);

    if (reduced) draw(start);
    else play();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      pause();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}

function makeTiles(count = 170): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    // Mostly small, far-away tiles; a few large, bright ones up close.
    const size = 6 + Math.pow(Math.random(), 2.2) * 22;
    const depth = (size - 6) / 22;
    tiles.push({
      x: Math.random(),
      // Denser toward the bottom of the panel.
      y: 1 - Math.pow(Math.random(), 1.5),
      size,
      radius: size * 0.3125, // the logo's corner-radius proportion
      color: pickColor(depth),
      alpha: 0.12 + depth * 0.7,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.3 + Math.random() * 0.9,
      driftX: 6 + Math.random() * 14,
      driftY: 4 + Math.random() * 10,
      driftSpeed: 0.05 + Math.random() * 0.12,
    });
  }
  return tiles;
}

function pickColor(depth: number): string {
  const palette = depth > 0.55 ? NEAR_COLORS : depth > 0.25 && Math.random() < 0.35 ? NEAR_COLORS : FAR_COLORS;
  return palette[Math.floor(Math.random() * palette.length)];
}
