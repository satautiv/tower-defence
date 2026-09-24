import { afterEach, describe, expect, it, vi } from 'vitest';
import { unlockAllStages } from '@ui/devFlags';

/**
 * The dev-only hatch past the campaign gate (#81).
 *
 * It exists because `docs/PLAYTEST-REGION1.md` forbids opening the dev overlay
 * in front of a tester, so an unlock reachable only through `~` is no use to
 * the person who actually needs one — someone setting up Session B, which is
 * played on 1-8 and would otherwise want a seven-stage warm-up first.
 */
describe('?unlock=all', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('opens on the exact parameter and nothing near it', () => {
    expect(unlockAllStages('?unlock=all')).toBe(true);
    expect(unlockAllStages('?unlock=all&stage=1-8')).toBe(true);
    expect(unlockAllStages('?debug=1&unlock=all')).toBe(true);
  });

  it('stays shut on anything else', () => {
    for (const search of ['', '?', '?unlock=', '?unlock=1', '?unlock=ALL', '?unlocked=all']) {
      expect(unlockAllStages(search)).toBe(false);
    }
  });

  /**
   * The property the whole design rests on.
   *
   * `import.meta.env.DEV` is replaced by a literal at build time, so in a
   * production bundle the body below it is dead code Rollup drops — and a
   * shipped build cannot be unlocked by typing in the URL bar. That is not
   * tidiness: #60 puts leaderboards on these stages, and a URL that skipped the
   * campaign would be a cheat anyone could share.
   */
  it('does nothing at all in a production build', () => {
    vi.stubEnv('DEV', false);
    expect(unlockAllStages('?unlock=all')).toBe(false);
  });

  /* No query string in a non-browser caller, rather than a thrown reference. */
  it('is shut when there is no location to read', () => {
    expect(unlockAllStages()).toBe(false);
  });
});
