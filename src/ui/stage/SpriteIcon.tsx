import type { ReactElement } from 'react';
import type { AtlasIndex } from '@view/assets';

export interface SpriteIconProps {
  /** Null until the atlas has loaded. */
  atlas: AtlasIndex | null;
  frame: string;
  /** Edge of the square the sprite is fitted into, in CSS pixels. */
  size: number;
  label: string;
}

/**
 * A sprite from the game atlas, drawn in the DOM as a CSS sprite.
 *
 * Until the atlas arrives, or for a frame it does not have, a plain initial
 * stands in. A wrong icon would be worse than none: it would tell the player a
 * different enemy is coming.
 */
export function SpriteIcon({ atlas, frame, size, label }: SpriteIconProps): ReactElement {
  const rect = atlas?.frames.get(frame);

  if (atlas === null || rect === undefined) {
    return (
      <span
        className="ui-sprite ui-sprite--missing"
        role="img"
        aria-label={label}
        style={{ width: size, height: size }}
      >
        {label.charAt(0)}
      </span>
    );
  }

  const scale = size / Math.max(rect.w, rect.h);
  return (
    <span
      className="ui-sprite"
      role="img"
      aria-label={label}
      style={{
        width: rect.w * scale,
        height: rect.h * scale,
        backgroundImage: `url(${atlas.image})`,
        backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        backgroundPosition: `${-rect.x * scale}px ${-rect.y * scale}px`,
      }}
    />
  );
}
