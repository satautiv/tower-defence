/**
 * Fixed-capacity event buffer.
 *
 * The simulation never calls out to anything. It writes events into a buffer,
 * and the view and audio layers drain that buffer each frame. That indirection
 * is exactly what lets the simulation run headless under Node with nobody
 * listening (docs/TECH_DESIGN.md §5).
 *
 * Records are preallocated and reused, and `acquire` hands back a reference to
 * fill rather than taking an object to copy, so emitting an event allocates
 * nothing. The cost is that a record is only valid until the next `clear()` —
 * consumers must read what they need during the drain, not retain the record.
 *
 * Payloads are five untyped numeric slots. Meaning is assigned by the layer
 * that defines the event kinds (sim/events.ts), which wraps these in typed
 * emit and read helpers. Keeping the transport untyped is what allows one
 * preallocated record shape to serve every event.
 */

export interface EventRecord {
  kind: number;
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}

function blankRecord(): EventRecord {
  return { kind: 0, a: 0, b: 0, c: 0, d: 0, e: 0 };
}

export class EventBuffer {
  private readonly records: EventRecord[];
  private readonly max: number;
  private used = 0;
  private lost = 0;

  constructor(capacity: number) {
    if (capacity <= 0) throw new RangeError('EventBuffer: capacity must be positive');
    this.max = capacity;
    this.records = new Array<EventRecord>(capacity);
    for (let i = 0; i < capacity; i++) this.records[i] = blankRecord();
  }

  /**
   * Reserves the next record and returns it for the caller to fill.
   * Returns null when full.
   *
   * A full buffer drops the newest event rather than overwriting the oldest.
   * Overwriting would silently discard something already emitted — a death
   * that never plays its sound, a reaction that never renders — and the loss
   * would be invisible. Dropping forward keeps everything already recorded and
   * leaves `dropped` non-zero, which is observable.
   */
  acquire(kind: number): EventRecord | null {
    if (this.used >= this.max) {
      this.lost++;
      return null;
    }
    const record = this.records[this.used] as EventRecord;
    this.used++;
    record.kind = kind;
    record.a = 0;
    record.b = 0;
    record.c = 0;
    record.d = 0;
    record.e = 0;
    return record;
  }

  /** Convenience for the common case of a fully-specified event. */
  push(kind: number, a = 0, b = 0, c = 0, d = 0, e = 0): boolean {
    const r = this.acquire(kind);
    if (r === null) return false;
    r.a = a;
    r.b = b;
    r.c = c;
    r.d = d;
    r.e = e;
    return true;
  }

  /** Records written since the last clear. Iterate `0 .. count-1` with `at`. */
  get count(): number {
    return this.used;
  }

  at(index: number): EventRecord {
    if (index < 0 || index >= this.used) {
      throw new RangeError(`EventBuffer.at: ${index} outside 0..${this.used - 1}`);
    }
    return this.records[index] as EventRecord;
  }

  /** Events refused because the buffer was full. Non-zero means capacity is too low. */
  get dropped(): number {
    return this.lost;
  }

  get capacity(): number {
    return this.max;
  }

  /** Marks every record reusable. Consumers must have finished reading. */
  clear(): void {
    this.used = 0;
  }

  /** Clears records and the drop counter. For starting a fresh stage. */
  reset(): void {
    this.used = 0;
    this.lost = 0;
  }
}
