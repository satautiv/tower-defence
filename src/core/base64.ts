/**
 * Base64 for binary payloads, implemented rather than borrowed.
 *
 * The obvious encoders are both out of reach. `btoa`/`atob` are DOM globals and
 * `Buffer` is Node's, while the thing that needs encoding is a world snapshot
 * built in `sim/`, which may touch neither (docs/adr/0002). Writing it here in
 * `core/` keeps the layer rule intact and costs forty lines.
 *
 * Works on bytes, not text. Every caller is handing over a typed array's
 * buffer, and a string round trip through UTF-8 would corrupt any byte above
 * 0x7f — which, in a Float32Array of world coordinates, is most of them.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Reverse lookup, built once.
 *
 * 123 entries covers '{', the highest character the alphabet uses ('z' is 122).
 * Anything outside the alphabet stays -1, which is what makes an invalid
 * character detectable rather than silently decoded as zero.
 */
const LOOKUP = (() => {
  const table = new Int8Array(123).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export class Base64Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base64Error';
  }
}

/**
 * Encodes a view's bytes.
 *
 * Takes the view's own window on its buffer — `byteOffset` and `byteLength`
 * rather than the whole `ArrayBuffer` — because a typed array may be a slice of
 * something larger, and encoding the whole buffer would silently include its
 * neighbours.
 */
export function encodeBase64(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  /* Built in chunks rather than by `+=` on one string: a snapshot's largest
     pool is tens of kilobytes, and repeated concatenation of that is what turns
     a save into a visible stall on a phone. */
  const parts: string[] = [];
  let chunk = '';

  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const word =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    chunk +=
      (ALPHABET[(word >>> 18) & 63] as string) +
      (ALPHABET[(word >>> 12) & 63] as string) +
      (ALPHABET[(word >>> 6) & 63] as string) +
      (ALPHABET[word & 63] as string);
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }

  /* The tail: one or two bytes that do not fill a 24-bit group. Padded with
     '=' so the decoder can tell two bytes from three. */
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const word = (bytes[i] as number) << 16;
    chunk +=
      (ALPHABET[(word >>> 18) & 63] as string) + (ALPHABET[(word >>> 12) & 63] as string) + '==';
  } else if (remaining === 2) {
    const word = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    chunk +=
      (ALPHABET[(word >>> 18) & 63] as string) +
      (ALPHABET[(word >>> 12) & 63] as string) +
      (ALPHABET[(word >>> 6) & 63] as string) +
      '=';
  }

  parts.push(chunk);
  return parts.join('');
}

/**
 * Decodes into bytes.
 *
 * Throws on anything malformed rather than returning what it managed to read.
 * This decodes saved games: a payload that has been truncated or corrupted must
 * surface as a failed load with the file kept aside, never as a world restored
 * from half its state (docs/TECH_DESIGN.md §12.2).
 */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) {
    throw new Base64Error(`base64 length ${text.length} is not a multiple of 4`);
  }
  if (text.length === 0) return new Uint8Array(0);

  let padding = 0;
  if (text.charCodeAt(text.length - 1) === 61 /* '=' */) padding++;
  if (text.charCodeAt(text.length - 2) === 61) padding++;

  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let out = 0;

  for (let i = 0; i < text.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      const code = text.charCodeAt(i + j);
      /* Padding only ever belongs in the final group, and only in its last two
         places; anywhere else it is a corrupted payload wearing a valid
         character. */
      if (code === 61) {
        const isTail = i + 4 === text.length && j >= 2;
        if (!isTail) throw new Base64Error(`unexpected padding at index ${i + j}`);
        word <<= 6;
        continue;
      }
      const value = code < LOOKUP.length ? (LOOKUP[code] as number) : -1;
      if (value < 0) throw new Base64Error(`invalid base64 character at index ${i + j}`);
      word = (word << 6) | value;
    }

    if (out < bytes.length) bytes[out++] = (word >>> 16) & 255;
    if (out < bytes.length) bytes[out++] = (word >>> 8) & 255;
    if (out < bytes.length) bytes[out++] = word & 255;
  }

  return bytes;
}
