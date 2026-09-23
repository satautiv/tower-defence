/**
 * Where a frame went: simulation against rendering (#41).
 *
 * A single frame-time number says the frame was slow and nothing about which
 * half to look at, and the two have separate budgets (§ "Budgets": sim <=4ms,
 * render <=8ms). Splitting them turns "it drops frames on wave nine" into
 * either "three hundred enemies cost too much to tick" or "three hundred
 * sprites cost too much to draw", which are different bugs with different
 * fixes.
 *
 * The ring buffers are sized to hold a couple of seconds, because the question
 * is always about a hitch that has just happened rather than about a long
 * average — and the mean is reported next to the worst for the same reason
 * `FrameMetrics` reports both.
 */

const SAMPLE_COUNT = 120;

export interface SplitStats {
  /** Mean milliseconds inside `tick`, across the window. */
  simMs: number;
  /** Mean milliseconds spent drawing, across the window. */
  renderMs: number;
  /**
   * Mean wall-clock milliseconds between frames.
   *
   * Reported beside the split rather than derived from it, and the difference
   * matters: `simMs + renderMs` is how much work a frame did, which on a
   * healthy machine is a small fraction of the 16.6ms it was given. Dividing
   * a thousand by the work would have read 4,317 fps on a board doing almost
   * nothing, which is the first thing the overlay said when it was put in
   * front of a browser.
   */
  frameMs: number;
  /** From `frameMs`, so it is the rate the screen is actually refreshing at. */
  fps: number;
  worstSimMs: number;
  worstRenderMs: number;
  /** Simulation ticks run in the last frame. Three at 3x speed. */
  ticks: number;
  samples: number;
}

export class SplitTimer {
  private readonly sim = new Float32Array(SAMPLE_COUNT);
  private readonly render = new Float32Array(SAMPLE_COUNT);
  private readonly frame = new Float32Array(SAMPLE_COUNT);
  private next = 0;
  private filled = 0;

  private frameStart = 0;
  private simEnd = 0;
  private lastTicks = 0;
  private lastBegin = -1;
  private sinceLastFrame = 0;

  begin(nowMs: number): void {
    this.sinceLastFrame = this.lastBegin < 0 ? 0 : nowMs - this.lastBegin;
    this.lastBegin = nowMs;
    this.frameStart = nowMs;
    this.simEnd = nowMs;
  }

  /** Stamps the boundary. Everything after this frame counts as rendering. */
  endSim(nowMs: number, ticks: number): void {
    this.simEnd = nowMs;
    this.lastTicks = ticks;
  }

  end(nowMs: number): void {
    /* The first frame after opening the panel has no previous frame to measure
       against, so it is dropped rather than recorded as an instant one. */
    if (this.sinceLastFrame <= 0) return;

    this.frame[this.next] = this.sinceLastFrame;
    this.sim[this.next] = this.simEnd - this.frameStart;
    this.render[this.next] = nowMs - this.simEnd;
    this.next = (this.next + 1) % SAMPLE_COUNT;
    if (this.filled < SAMPLE_COUNT) this.filled++;
  }

  /**
   * The window in frame order, oldest first, for the graph.
   *
   * Written into caller-supplied arrays: the panel redraws at 10Hz and holds
   * its own pair, so reading the timings never allocates.
   */
  samples(sim: Float32Array, render: Float32Array): number {
    const n = Math.min(this.filled, sim.length, render.length);
    for (let i = 0; i < n; i++) {
      /* Walk backwards from the write head so the newest sample lands last,
         which is what makes the graph read left to right. */
      const at = (this.next - n + i + SAMPLE_COUNT * 2) % SAMPLE_COUNT;
      sim[i] = this.sim[at] as number;
      render[i] = this.render[at] as number;
    }
    return n;
  }

  stats(): SplitStats {
    if (this.filled === 0) {
      return {
        simMs: 0,
        renderMs: 0,
        frameMs: 0,
        fps: 0,
        worstSimMs: 0,
        worstRenderMs: 0,
        ticks: 0,
        samples: 0,
      };
    }

    let simTotal = 0;
    let renderTotal = 0;
    let frameTotal = 0;
    let worstSim = 0;
    let worstRender = 0;
    for (let i = 0; i < this.filled; i++) {
      const s = this.sim[i] as number;
      const r = this.render[i] as number;
      simTotal += s;
      renderTotal += r;
      frameTotal += this.frame[i] as number;
      if (s > worstSim) worstSim = s;
      if (r > worstRender) worstRender = r;
    }

    const frameMs = frameTotal / this.filled;
    return {
      simMs: simTotal / this.filled,
      renderMs: renderTotal / this.filled,
      frameMs,
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      worstSimMs: worstSim,
      worstRenderMs: worstRender,
      ticks: this.lastTicks,
      samples: this.filled,
    };
  }

  reset(): void {
    this.next = 0;
    this.filled = 0;
    this.lastTicks = 0;
    this.lastBegin = -1;
    this.sinceLastFrame = 0;
  }
}
