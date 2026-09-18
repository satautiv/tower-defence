import { Sprite } from 'pixi.js';

export function typeError(): number {
  const n: number = 'not a number';
  return n + Sprite.length;
}
