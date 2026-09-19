import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The acceptance criterion for #9, enforced rather than grepped by hand.
 *
 * The value of the platform layer is that the rest of the codebase cannot tell
 * which platform it is on. That property decays one convenient branch at a
 * time: someone reaches for localStorage directly because it is right there,
 * and a year later the Android port has to find every such spot. Catching the
 * first one is what keeps #54 a packaging exercise.
 */

const SRC = 'src';
const PLATFORM_DIR = join('src', 'platform');

interface Forbidden {
  pattern: RegExp;
  why: string;
}

const FORBIDDEN: Forbidden[] = [
  {
    pattern: /\bisNativePlatform\b/,
    why: 'platform detection belongs to src/platform/detect.ts',
  },
  {
    pattern: /\bCapacitor\b/,
    why: 'game code must not know Capacitor exists; use the Platform interface',
  },
  {
    pattern: /(?<![\w.])localStorage\b/,
    why: 'storage goes through SaveAdapter, so the Android port can swap it',
  },
  {
    pattern: /(?<![\w.])indexedDB\b/,
    why: 'storage goes through SaveAdapter, so the Android port can swap it',
  },
  {
    pattern: /navigator\s*\.\s*vibrate/,
    why: 'vibration goes through the Haptics interface',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Strips comments, so prose explaining a rule does not trip it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('no platform conditionals outside src/platform', () => {
  const files = sourceFiles(SRC).filter((file) => !file.startsWith(PLATFORM_DIR));

  it('finds source files to check, so a broken scan cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(FORBIDDEN)('nothing references $pattern — $why', ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(code(readFileSync(file, 'utf8'))));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('would catch a violation if one were introduced', () => {
    /* Guards the guard: a regex that matched nothing would also pass above. */
    const sample = 'if (isNativePlatform()) { useNativeThing(); }';
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(sample))).toBe(true);
  });

  it('does not trip on ordinary DOM use, which is not a platform branch', () => {
    const fine = 'const dpr = globalThis.devicePixelRatio; document.createElement("canvas");';
    expect(FORBIDDEN.every(({ pattern }) => !pattern.test(fine))).toBe(true);
  });
});
