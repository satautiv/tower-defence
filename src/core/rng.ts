/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The simulation must be reproducible from a seed alone: a replay is a seed
 * plus an ordered command list, and the balance simulator needs the same stage
 * to play out identically across runs. `Math.random()` is therefore banned in
 * core/ and sim/ by lint rule, and every random decision comes from here.
 *
 * mulberry32 is chosen for having a single 32-bit word of state — it
 * serialises into a world snapshot as one number, with no pool of state to
 * walk — while still passing gjrand and being fast enough to call thousands of
 * times per tick.
 */
export class Rng {
  /** The entire generator state. One word, trivially serialisable. */
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
  }

  /** Raw generator step. Uniform over the full unsigned 32-bit range. */
  nextUint32(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, maxExclusive). Returns min if the span is empty. */
  int(min: number, maxExclusive: number): number {
    const span = maxExclusive - min;
    return span <= 0 ? min : min + Math.floor(this.next() * span);
  }

  /** Uniform integer in [min, max]. */
  intInclusive(min: number, max: number): number {
    return this.int(min, max + 1);
  }

  /** True with probability `p`. */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Uniform choice. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty list');
    return items[this.int(0, items.length)] as T;
  }

  /**
   * Weighted choice. Weights need not be normalised; negatives are treated as
   * zero. Used for things like which branch of a path an enemy takes.
   */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new RangeError('Rng.pickWeighted: empty list');
    if (items.length !== weights.length) {
      throw new RangeError('Rng.pickWeighted: items and weights differ in length');
    }

    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i] as number);
    if (total <= 0) return this.pick(items);

    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i] as number);
      if (roll < 0) return items[i] as T;
    }
    /* Only reachable through floating-point drift on the final comparison. */
    return items[items.length - 1] as T;
  }

  /** In-place Fisher-Yates. Deterministic for a given state. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Snapshot the generator. Pairs with `setState` for save/replay. */
  getState(): number {
    return this.s;
  }

  setState(state: number): void {
    this.s = state | 0;
  }

  /** Independent generator at the same position. Advancing one will not move the other. */
  clone(): Rng {
    return new Rng(this.s);
  }
}

/**
 * Derives a numeric seed from a string, so a stage can be seeded by its id.
 * FNV-1a: not cryptographic, but well distributed and stable across platforms,
 * which is all a reproducible seed needs.
 */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}
