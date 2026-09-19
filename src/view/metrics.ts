/**
 * Frame timing, for measuring the game on a real device.
 *
 * Exists because "does it hold 60fps on a mid-range phone" is a question that
 * needs answering on the phone, and attaching a profiler to a WebView is far
 * more friction than reading a number off the screen.
 *
 * Averages hide the problem. A stage that renders at 60fps with one 90ms hitch
 * per wave feels broken while averaging beautifully, so the worst frame and the
 * 95th percentile are reported alongside the mean.
 *
 * Lives in view/ rather than core/ because it reads the wall clock, which the
 * simulation is forbidden from doing.
 */

import { detectRendererSupport } from './support.js';

const SAMPLE_COUNT = 240;

export interface FrameStats {
  fps: number;
  /** Mean frame time in milliseconds. */
  meanMs: number;
  /** 95th percentile: the hitches a mean would hide. */
  p95Ms: number;
  worstMs: number;
  /** Frames over 16.7ms since the last reset. */
  droppedFrames: number;
  samples: number;
}

export class FrameMetrics {
  private readonly samples = new Float32Array(SAMPLE_COUNT);
  private readonly sorted = new Float32Array(SAMPLE_COUNT);
  private next = 0;
  private filled = 0;
  private dropped = 0;
  private lastTime = 0;

  /** Milliseconds from page load to the first simulated frame. */
  private firstFrameAt = -1;

  record(nowMs: number): void {
    if (this.lastTime > 0) {
      const delta = nowMs - this.lastTime;
      this.samples[this.next] = delta;
      this.next = (this.next + 1) % SAMPLE_COUNT;
      if (this.filled < SAMPLE_COUNT) this.filled++;
      if (delta > 16.7) this.dropped++;
    } else {
      /* The first frame's delta is meaningless — it spans everything that
         happened before the loop started. */
      this.firstFrameAt = nowMs;
    }
    this.lastTime = nowMs;
  }

  get timeToFirstFrameMs(): number {
    return this.firstFrameAt;
  }

  stats(): FrameStats {
    if (this.filled === 0) {
      return { fps: 0, meanMs: 0, p95Ms: 0, worstMs: 0, droppedFrames: 0, samples: 0 };
    }

    let total = 0;
    let worst = 0;
    for (let i = 0; i < this.filled; i++) {
      const value = this.samples[i] as number;
      total += value;
      if (value > worst) worst = value;
      this.sorted[i] = value;
    }

    const window = this.sorted.subarray(0, this.filled);
    window.sort();
    const mean = total / this.filled;

    return {
      fps: mean > 0 ? 1000 / mean : 0,
      meanMs: mean,
      p95Ms: window[Math.min(this.filled - 1, Math.floor(this.filled * 0.95))] as number,
      worstMs: worst,
      droppedFrames: this.dropped,
      samples: this.filled,
    };
  }

  reset(): void {
    this.next = 0;
    this.filled = 0;
    this.dropped = 0;
    this.lastTime = 0;
  }
}

export interface DeviceInfo {
  renderer: string;
  webgl2: boolean;
  /** True when there is no GPU behind the context and the CPU draws every pixel. */
  software: boolean;
  devicePixelRatio: number;
  screen: string;
  /** Megabytes, where the browser reports it. Chrome and the Android WebView do. */
  heapMb: number | null;
  platform: string;
}

interface MemoryCapableperformance {
  memory?: { usedJSHeapSize: number };
}

/**
 * What the device says about itself.
 *
 * The renderer string is the important one: a WebView or a VM falling back to
 * software rendering still reports full WebGL2 support and still runs, just far
 * too slowly, and that is invisible from a frame counter alone.
 *
 * The probe is `detectRendererSupport`, the same one the renderer configures
 * itself from, so what is displayed here cannot drift from what was decided.
 */
export function deviceInfo(): DeviceInfo {
  const support = detectRendererSupport();
  const memory = (performance as unknown as MemoryCapableperformance).memory;

  return {
    renderer: support.renderer,
    webgl2: support.webgl2,
    software: support.software,
    devicePixelRatio: globalThis.devicePixelRatio ?? 1,
    screen: `${globalThis.innerWidth}x${globalThis.innerHeight}`,
    heapMb: memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1024 / 1024),
    platform: navigator.userAgent.includes('Android') ? 'android' : 'web',
  };
}
