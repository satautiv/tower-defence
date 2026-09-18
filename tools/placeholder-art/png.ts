import { deflateSync } from 'node:zlib';

/**
 * A minimal RGBA PNG encoder.
 *
 * Placeholder art needs to be real image files — Pixi has to decode them, the
 * atlas packer has to measure them — but pulling in an image library to draw
 * coloured circles would be a dependency the project carries forever for work
 * that #42 deletes. PNG's uncompressed-RGBA path is about forty lines.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** `rgba` is width * height * 4 bytes, row-major, non-premultiplied. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  /* One filter byte per scanline. Filter 0 (none) keeps this readable; these
     images are a few hundred bytes either way. */
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A blank transparent canvas to draw into. */
export function createCanvas(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function setPixel(pixels: Uint8Array, width: number, x: number, y: number, colour: Rgba): void {
  const i = (y * width + x) * 4;
  pixels[i] = colour.r;
  pixels[i + 1] = colour.g;
  pixels[i + 2] = colour.b;
  pixels[i + 3] = colour.a;
}

/** Filled circle with a darker rim, so silhouettes stay readable when overlapping. */
export function drawDisc(
  pixels: Uint8Array,
  size: number,
  fill: Rgba,
  rim: Rgba,
  radiusScale = 0.45,
): void {
  const centre = (size - 1) / 2;
  const radius = size * radiusScale;
  const rimStart = radius - Math.max(1.5, size * 0.06);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - centre, y - centre);
      if (d > radius) continue;
      setPixel(pixels, size, x, y, d >= rimStart ? rim : fill);
    }
  }
}

/** Filled square with a rim. Used for towers, which read as built structures. */
export function drawBlock(
  pixels: Uint8Array,
  size: number,
  fill: Rgba,
  rim: Rgba,
  inset = 0.18,
): void {
  const from = Math.round(size * inset);
  const to = size - from;
  const border = Math.max(2, Math.round(size * 0.08));

  for (let y = from; y < to; y++) {
    for (let x = from; x < to; x++) {
      const onRim = x < from + border || x >= to - border || y < from + border || y >= to - border;
      setPixel(pixels, size, x, y, onRim ? rim : fill);
    }
  }
}

/** Hollow diamond, for build plots. */
export function drawDiamond(pixels: Uint8Array, size: number, rim: Rgba): void {
  const centre = (size - 1) / 2;
  const radius = size * 0.42;
  const thickness = Math.max(1.5, size * 0.07);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - centre) + Math.abs(y - centre);
      if (d <= radius && d >= radius - thickness) setPixel(pixels, size, x, y, rim);
    }
  }
}
