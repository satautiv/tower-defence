import { describe, expect, it } from 'vitest';
import { Base64Error, decodeBase64, encodeBase64 } from '@core/base64';

/**
 * These check the encoder against the property that actually matters for the
 * save system: bytes in, identical bytes out, for every byte value and every
 * length modulo 3. A save that round-trips for text and mangles 0x80 would pass
 * a laxer test and corrupt every float in a snapshot.
 */

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('base64', () => {
  it('round-trips the empty payload', () => {
    expect(encodeBase64(bytes())).toBe('');
    expect(decodeBase64('')).toEqual(bytes());
  });

  it('matches known vectors from RFC 4648', () => {
    const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(encodeBase64(ascii('f'))).toBe('Zg==');
    expect(encodeBase64(ascii('fo'))).toBe('Zm8=');
    expect(encodeBase64(ascii('foo'))).toBe('Zm9v');
    expect(encodeBase64(ascii('foob'))).toBe('Zm9vYg==');
    expect(encodeBase64(ascii('fooba'))).toBe('Zm9vYmE=');
    expect(encodeBase64(ascii('foobar'))).toBe('Zm9vYmFy');
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(decodeBase64(encodeBase64(all))).toEqual(all);
  });

  it('round-trips every length up to three groups', () => {
    for (let length = 0; length <= 12; length++) {
      const payload = new Uint8Array(length);
      for (let i = 0; i < length; i++) payload[i] = (i * 37 + 11) & 255;
      expect(decodeBase64(encodeBase64(payload))).toEqual(payload);
    }
  });

  /* The reason this file exists rather than a call to btoa: a snapshot is
     Float32Array coordinates and Int32Array ticks, not text. */
  it('round-trips a float array bit-exactly, negative zero included', () => {
    const floats = Float32Array.from([0, -0, 1.5, -1.5, 1 / 3, -12345.678, Infinity, -Infinity]);
    const back = new Float32Array(decodeBase64(encodeBase64(floats)).buffer);
    expect(Array.from(back)).toEqual(Array.from(floats));
    /* toEqual treats 0 and -0 as equal, so the sign bit is checked directly. */
    expect(Object.is(back[1], -0)).toBe(true);
  });

  it('round-trips a large payload across the chunk boundary', () => {
    const big = new Uint8Array(40_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
    expect(decodeBase64(encodeBase64(big))).toEqual(big);
  });

  /* A typed array can be a window onto a larger buffer. Encoding the whole
     buffer would silently include its neighbours. */
  it('encodes only the view, not the buffer behind it', () => {
    const buffer = new ArrayBuffer(12);
    new Uint8Array(buffer).fill(0xff);
    const middle = new Uint8Array(buffer, 4, 4);
    middle.set([1, 2, 3, 4]);
    expect(decodeBase64(encodeBase64(middle))).toEqual(bytes(1, 2, 3, 4));
  });

  describe('rejects corruption rather than decoding what it can', () => {
    it('refuses a truncated payload', () => {
      expect(() => decodeBase64('Zm9vYmF')).toThrow(Base64Error);
    });

    it('refuses a character outside the alphabet', () => {
      expect(() => decodeBase64('Zm9v!mFy')).toThrow(Base64Error);
      expect(() => decodeBase64('Zm9vYmFÿ')).toThrow(Base64Error);
    });

    it('refuses padding anywhere but the tail', () => {
      expect(() => decodeBase64('Zm==Zm9v')).toThrow(Base64Error);
      expect(() => decodeBase64('=m9vYmFy')).toThrow(Base64Error);
    });
  });
});
