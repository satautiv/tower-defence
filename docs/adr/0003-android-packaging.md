# ADR-0003 — Android packaging, and what the smoke build proved

**Status:** Accepted, with one criterion outstanding · **Date:** 2026-09-19 · **Issue:** [#20](https://github.com/satautiv/tower-defence/issues/20)

## Context

`docs/TECH_DESIGN.md` §2 commits to one codebase serving the browser now and Android later,
wrapped by Capacitor. The risk register (T2) calls that a *contained* risk rather than an
absent one, and #20 exists to find out which — **at M1, not at M6**. Discovering a platform
problem after five more milestones of work is how ports die.

## Decision

**Capacitor 8.5.2**, not the 6 the plan assumed. The plan was written when 6 was current;
8 is the current major, the API this project uses is unchanged, and pinning to a superseded
major at the moment of adoption would mean an upgrade before the port even starts.

The generated `android/` project is **committed**; its build artefacts are not. A
regenerated project would silently discard whatever #54 configures there — signing, the
target API level, plugin registration.

`minSdkVersion 24` (Android 7.0), `targetSdkVersion 36`, as Capacitor's template sets them.
That matches the WebView floor the technical plan assumes.

## What was verified

Without an Android SDK in this environment, an APK cannot be built here. Everything short
of that was checked:

| | |
|---|---|
| Android project generates | ✅ |
| Web build syncs into it | ✅ `dist` → `android/app/src/main/assets/public` |
| Atlas and content ship with it | ✅ `game.json`, `game.png` present in the synced assets |
| Bundle stays inside budget | ✅ 283 kB gzipped, 56.5% of 500 kB |
| Capacitor adds nothing to the web bundle | ✅ no Capacitor code in `dist` |
| The platform guardrail still holds | ✅ `tests/platform/no-conditionals.test.ts` passes **with Capacitor installed** |

That last row is the one worth dwelling on. `src/platform/detect.ts` reads the global
Capacitor injects into the WebView rather than importing `@capacitor/core`, so installing
the package changed nothing about what the game imports — and the test that would have
caught a leak still passes. The #9 design paid for itself here rather than in #54.

## What is outstanding

**The slice has not run on a physical device.** That is the acceptance criterion this ADR
cannot close, and it is deliberately not marked as met.

Running it needs an Android SDK and a phone:

```bash
npm run android:sync     # build the web bundle and copy it into android/
npm run android:open     # then Run in Android Studio, or:
npm run android:run      # build, install and launch on a connected device
```

### What to record

Tap **fps** in the bottom-left of the stage screen. It reports what #56 will be measured
against:

- **Sustained frame rate** during the heaviest wave, and the **p95 and worst** frame times
  beside it — a stage averaging 60fps with one 90ms hitch per wave feels broken while
  measuring beautifully
- **Time to first frame**, against the 15-second launch-to-playing criterion
- **Heap**, for the memory baseline
- **Renderer string** — the important one. A WebView falling back to software rendering
  still runs, just far too slowly, and a frame counter alone cannot tell you that is what
  happened. It should name the GPU.

## Consequences

- Capacitor is a dependency of the web build's *package*, but not of its *bundle*. Nothing
  in `src/` imports it, and the guardrail test keeps it that way.
- The plugins — Preferences, Haptics, App lifecycle, StatusBar — are **not** installed.
  They arrive with #54, which is also where the platform adapters stop delegating to their
  web implementations.
- `src/ui/stage/Diagnostics.tsx` and `src/view/metrics.ts` exist to make on-device
  measurement possible without attaching a debugger to a WebView. They are a visible
  toggle rather than a hidden gesture, because whoever holds the phone may not be whoever
  wrote the code. #41 replaces them with the full dev overlay and gates it out of
  production builds.
- If the device run surfaces an architectural problem, it gets its own issue immediately —
  that is the entire point of doing this now rather than at M6.
