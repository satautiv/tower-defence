import { describe, expect, it } from 'vitest';
import { SOFTWARE_MAX_FPS, isSoftwareRenderer } from '@view/support';
import { MAX_CATCHUP_STEPS, TICK_HZ } from '@core/constants';

/**
 * Telling a GPU from a CPU pretending to be one.
 *
 * A software rasteriser advertises complete, conformant WebGL2 and then draws
 * every pixel on the CPU. Capability detection says yes, the game starts, and
 * the only signal that anything is wrong is the renderer string — so if this
 * predicate is wrong, the renderer pays full fill-rate costs on a machine that
 * cannot afford them, and the symptom is a frozen host rather than a slow game.
 */
describe('isSoftwareRenderer', () => {
  /* Real strings. Fabricated ones would only prove the matcher matches itself. */
  it.each([
    /* Chrome inside a VirtualBox/VMware guest with no 3D acceleration — the
       string this project was actually diagnosed from. */
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)',
    'llvmpipe (LLVM 17.0.6, 256 bits)',
    'SwiftShader Device (Subzero)',
    'Mesa, softpipe',
    'llvmpipe, lavapipe (LLVM 16)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
    'Mesa OffScreen',
    'Apple Software Renderer',
  ])('recognises %s as software', (renderer) => {
    expect(isSoftwareRenderer(renderer)).toBe(true);
  });

  it.each([
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.6)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Adreno (TM) 650',
    'Mali-G78 MP14',
    'Apple GPU',
    'Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2)',
  ])('leaves %s alone', (renderer) => {
    expect(isSoftwareRenderer(renderer)).toBe(false);
  });

  it('matches regardless of case', () => {
    expect(isSoftwareRenderer('SWIFTSHADER')).toBe(true);
    expect(isSoftwareRenderer('LLVMpipe')).toBe(true);
  });

  /* The probe falls back to these when the context or the extension is absent,
     and neither is evidence of software rendering. */
  it.each(['unknown', 'unavailable', ''])('does not guess from %s', (renderer) => {
    expect(isSoftwareRenderer(renderer)).toBe(false);
  });
});

describe('SOFTWARE_MAX_FPS', () => {
  /**
   * The cap throttles rendering, never the simulation. At this frame rate the
   * fixed-timestep loop must still be able to run a whole frame's worth of
   * ticks inside its catch-up budget, or capped frames would silently discard
   * simulated time and the guard would change the game rather than just its
   * cost.
   */
  it('leaves the loop able to catch up within its budget', () => {
    const ticksPerCappedFrame = TICK_HZ / SOFTWARE_MAX_FPS;
    expect(ticksPerCappedFrame).toBeLessThanOrEqual(MAX_CATCHUP_STEPS);
  });

  it('is low enough to give back real time on a CPU rasteriser', () => {
    expect(SOFTWARE_MAX_FPS).toBeLessThan(60);
  });
});
