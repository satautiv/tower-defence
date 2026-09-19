import { useState } from 'react';
import type { ReactElement } from 'react';
import { deviceInfo } from '@view/metrics';
import type { FrameStats } from '@view/metrics';
import { useThrottledValue } from '../hooks/useThrottledValue.js';
import { Button, INTERACTIVE, cx } from '../components/index.js';

export interface DiagnosticsProps {
  read: () => FrameStats;
  timeToFirstFrameMs: () => number;
  enemies: () => number;
}

/**
 * On-device measurements, readable without a profiler.
 *
 * Built for the Android smoke build (#20) and the device matrix (#56): the
 * questions those ask — does it hold 60fps, is the WebView actually using the
 * GPU, how long until it is playable — need answering on the phone, and
 * attaching a debugger to a WebView is far more friction than reading a number
 * off the screen.
 *
 * Deliberately a visible toggle rather than a hidden gesture, because whoever
 * is holding the phone may not be whoever wrote this. #41 replaces it with the
 * full dev overlay and gates it out of production builds.
 */
export function Diagnostics({ read, timeToFirstFrameMs, enemies }: DiagnosticsProps): ReactElement {
  const [open, setOpen] = useState(false);
  const stats = useThrottledValue(read, 4, (a, b) => a.samples === b.samples && a.fps === b.fps);
  const [device] = useState(deviceInfo);

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="ui-diagnostics__toggle"
        onClick={() => setOpen(true)}
        aria-label="Show performance diagnostics"
      >
        fps
      </Button>
    );
  }

  /* Red below 50: the budget is 60, and anything under 50 is visible as
     stutter rather than merely measurable. */
  const healthy = stats.fps >= 50;

  return (
    <div className={cx(INTERACTIVE, 'ui-diagnostics')} data-testid="diagnostics">
      <div className="ui-diagnostics__row">
        <span className={healthy ? 'ui-diagnostics__good' : 'ui-diagnostics__bad'}>
          {stats.fps.toFixed(0)} fps
        </span>
        <span>{stats.meanMs.toFixed(1)} ms</span>
      </div>
      <div className="ui-diagnostics__row">
        {/* A mean hides hitches; these are what actually feels broken. */}
        <span>p95 {stats.p95Ms.toFixed(1)}</span>
        <span>worst {stats.worstMs.toFixed(0)}</span>
      </div>
      <div className="ui-diagnostics__row">
        <span>dropped {stats.droppedFrames}</span>
        <span>enemies {enemies()}</span>
      </div>
      <div className="ui-diagnostics__row">
        <span>to first frame</span>
        <span>{(timeToFirstFrameMs() / 1000).toFixed(2)}s</span>
      </div>
      <div className="ui-diagnostics__row">
        <span>{device.webgl2 ? 'WebGL2' : 'NO WEBGL2'}</span>
        <span>{device.heapMb === null ? '—' : `${device.heapMb} MB`}</span>
      </div>
      <div className="ui-diagnostics__renderer">{device.renderer}</div>
      <div className="ui-diagnostics__renderer">
        {device.screen} @{device.devicePixelRatio}x · {device.platform}
      </div>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Hide
      </Button>
    </div>
  );
}
