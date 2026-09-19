import { describe, expect, it, vi } from 'vitest';
import { NoopAnalytics, WebHaptics } from '@platform/index';

describe('WebHaptics', () => {
  const navigatorWith = (vibrate?: unknown): Navigator => ({ vibrate }) as unknown as Navigator;

  it('vibrates for the requested intensity', () => {
    const vibrate = vi.fn(() => true);
    new WebHaptics(navigatorWith(vibrate)).impact('medium');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('uses a longer pulse for a heavier impact', () => {
    const vibrate = vi.fn(() => true);
    const haptics = new WebHaptics(navigatorWith(vibrate));
    haptics.impact('light');
    haptics.impact('heavy');

    const [light] = vibrate.mock.calls[0] as unknown as [number];
    const [heavy] = vibrate.mock.calls[1] as unknown as [number];
    expect(heavy).toBeGreaterThan(light);
  });

  /* Desktop browsers and iOS Safari have no vibration API at all. */
  it('does nothing where vibration is unsupported', () => {
    const haptics = new WebHaptics(navigatorWith(undefined));
    expect(haptics.supported).toBe(false);
    expect(() => haptics.impact('heavy')).not.toThrow();
  });

  it('does nothing with no navigator at all', () => {
    expect(() => new WebHaptics(undefined).impact('light')).not.toThrow();
  });

  it('stays silent while disabled', () => {
    const vibrate = vi.fn(() => true);
    const haptics = new WebHaptics(navigatorWith(vibrate));
    haptics.setEnabled(false);
    haptics.impact('heavy');

    expect(vibrate).not.toHaveBeenCalled();
    expect(haptics.enabled).toBe(false);
  });

  /* Haptics are a garnish; a permissions policy blocking them must never
     interrupt whatever the player was doing. */
  it('swallows an error from the vibration API', () => {
    const haptics = new WebHaptics(
      navigatorWith(() => {
        throw new Error('blocked by permissions policy');
      }),
    );
    expect(() => haptics.impact('medium')).not.toThrow();
  });
});

describe('NoopAnalytics', () => {
  /**
   * Off until the player says otherwise (docs/GAME_DESIGN.md §19). A default of
   * "on until refused" would also leave the game's behaviour with analytics
   * disabled effectively untested.
   */
  it('is disabled by default', () => {
    expect(new NoopAnalytics().enabled).toBe(false);
  });

  it('records nothing while disabled', () => {
    const analytics = new NoopAnalytics();
    analytics.track('stage_started', { stage: '1-1' });
    expect(analytics.events).toHaveLength(0);
  });

  it('records once enabled', () => {
    const analytics = new NoopAnalytics();
    analytics.setEnabled(true);
    analytics.track('stage_started', { stage: '1-1' });

    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0]?.event).toBe('stage_started');
    expect(analytics.events[0]?.properties).toEqual({ stage: '1-1' });
  });

  /* Opting out has to discard what was already gathered, not merely stop. */
  it('discards everything when switched off', () => {
    const analytics = new NoopAnalytics(true);
    analytics.track('a');
    analytics.setEnabled(false);
    expect(analytics.events).toHaveLength(0);
  });

  it('bounds its buffer so a long session cannot grow without limit', () => {
    const analytics = new NoopAnalytics(true, 10);
    for (let i = 0; i < 50; i++) analytics.track(`event_${i}`);

    expect(analytics.events).toHaveLength(10);
    expect(analytics.events[9]?.event).toBe('event_49');
  });

  it('never throws, whatever it is handed', () => {
    const analytics = new NoopAnalytics(true);
    expect(() => analytics.track('odd', { nested: { deep: [1, 2] }, nil: null })).not.toThrow();
  });
});
