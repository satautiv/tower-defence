/**
 * The contract between something that owns state and something that saves it.
 *
 * A pool knows what its state *is* — including the private bookkeeping no
 * amount of reflection from outside can see. The save system knows how state
 * should be *encoded*. Putting a writer and a reader between them lets each
 * keep its own job: pools never mention base64, and the snapshot never reaches
 * past a `private`.
 *
 * Keys are flat strings with dotted prefixes (`enemies.hp`,
 * `enemies.slots.generations`) rather than a nested object, because the reader
 * has to report precisely which field of which pool failed when a save turns
 * out to be corrupt, and a path is that report.
 */

import { decodeBase64, encodeBase64 } from './base64.js';

export interface BagWriter {
  num(key: string, value: number): void;
  /** Copies the view's bytes. The caller may keep mutating it afterwards. */
  view(key: string, value: ArrayBufferView): void;
}

export interface BagReader {
  num(key: string): number;
  /** Fills `target` from the saved bytes, or throws if they do not fit it. */
  into(key: string, target: ArrayBufferView): void;
}

export class SaveBagError extends Error {
  readonly key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = 'SaveBagError';
    this.key = key;
  }
}

/** A field as it appears in the save file: a bare number, or tagged bytes. */
export type SavedField = number | { readonly bytes: string; readonly length: number };

export type SavedBag = Readonly<Record<string, SavedField>>;

/**
 * Collects fields into a plain object ready for `JSON.stringify`.
 *
 * `length` is stored beside the bytes so a restore can reject a payload of the
 * wrong size before writing any of it, rather than filling half an array and
 * leaving the rest of the world at its previous values — a half-restored pool
 * is far worse than a refused load.
 */
export function createWriter(): { writer: BagWriter; bag: Record<string, SavedField> } {
  const bag: Record<string, SavedField> = {};
  const writer: BagWriter = {
    num(key, value) {
      bag[key] = value;
    },
    view(key, value) {
      bag[key] = { bytes: encodeBase64(value), length: value.byteLength };
    },
  };
  return { writer, bag };
}

function isBytes(field: SavedField | undefined): field is { bytes: string; length: number } {
  return (
    typeof field === 'object' &&
    field !== null &&
    typeof (field as { bytes?: unknown }).bytes === 'string' &&
    typeof (field as { length?: unknown }).length === 'number'
  );
}

/**
 * Reads fields back out.
 *
 * Every accessor throws on anything unexpected — a missing key, the wrong kind,
 * a payload that does not match the array it is going into. This is the layer
 * where a corrupt save is supposed to be caught (docs/TECH_DESIGN.md §12.2), so
 * it is strict on purpose and never substitutes a default.
 */
export function createReader(bag: SavedBag): BagReader {
  return {
    num(key) {
      const field = bag[key];
      if (typeof field !== 'number') {
        throw new SaveBagError(key, `${key}: expected a number`);
      }
      if (!Number.isFinite(field)) {
        throw new SaveBagError(key, `${key}: ${String(field)} is not a finite number`);
      }
      return field;
    },

    into(key, target) {
      const field = bag[key];
      if (!isBytes(field)) {
        throw new SaveBagError(key, `${key}: expected saved bytes`);
      }
      if (field.length !== target.byteLength) {
        throw new SaveBagError(
          key,
          `${key}: saved ${field.length} bytes, this build expects ${target.byteLength}`,
        );
      }

      const bytes = decodeBase64(field.bytes);
      if (bytes.byteLength !== target.byteLength) {
        throw new SaveBagError(
          key,
          `${key}: decoded to ${bytes.byteLength} bytes, expected ${target.byteLength}`,
        );
      }
      new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes);
    },
  };
}
