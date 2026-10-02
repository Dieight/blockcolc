import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GlassWorldCompositor, glassMaterialFor, glassRegionFor } from '../src/glass-surface';

describe('GPU glass contract', () => {
  it('copies only the bottom/right panel and never shifts or enlarges its layout', () => {
    expect(glassRegionFor(780, 1688, .3, 0)).toEqual({ x: 0, y: 0, width: 780, height: 507 });
    expect(glassRegionFor(1800, 1000, 0, .34)).toEqual({ x: 1188, y: 0, width: 612, height: 1000 });
    expect(glassRegionFor(1800, 1000, .3, .34)?.x).toBe(1188);
    expect(glassRegionFor(780, 1688, 0, 0)).toBeNull();
  });
  it('bounds invalid input and retains distinct frosted/clear settings in both themes', () => {
    expect(glassRegionFor(NaN, 100, .3, 0)).toBeNull();
    expect(glassRegionFor(100, 100, 8, NaN)?.height).toBe(75);
    expect(glassMaterialFor(NaN)).toEqual(glassMaterialFor(50));
    expect(glassMaterialFor(-1)).toEqual(glassMaterialFor(0));
    expect(glassMaterialFor(101)).toEqual(glassMaterialFor(100));
    const values = [0, 50, 100].map(glassMaterialFor);
    expect(values.map(v => v.blur)).toEqual([32, 17, 2]);
    expect(values[0]!.lightAlpha).toBeGreaterThan(values[1]!.lightAlpha);
    expect(values[1]!.lightAlpha).toBeGreaterThan(values[2]!.lightAlpha);
    expect(values[1]!.darkAlpha).toBeGreaterThan(values[1]!.lightAlpha);
  });
  it('restores render state after both GPU draws, and frees large targets when reduced transparency is requested', () => {
    const renderer = {
      capabilities: { maxTextureSize: 4096 }, autoClear: true,
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 1000), getPixelRatio: () => 2,
      getViewport: (v: THREE.Vector4) => v.set(0, 0, 400, 500),
      getScissor: (v: THREE.Vector4) => v.set(2, 3, 4, 5), getScissorTest: () => false,
      getRenderTarget: () => null, setRenderTarget: vi.fn(), setViewport: vi.fn(),
      setScissor: vi.fn(), setScissorTest: vi.fn(), copyFramebufferToTexture: vi.fn(), render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const glass = new GlassWorldCompositor(renderer);
    glass.setPreference({ enabled: true, clarity: 50, theme: 'dark', reducedTransparency: false });
    glass.render(.3, 0);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(renderer.setViewport).toHaveBeenLastCalledWith(new THREE.Vector4(0, 0, 400, 500));
    expect(renderer.setScissor).toHaveBeenLastCalledWith(new THREE.Vector4(2, 3, 4, 5));
    expect(glass.getDiagnostics()).toMatchObject({ mode: 'gpu', width: 800, height: 300, blurWidth: 400, blurHeight: 150 });
    glass.setPreference({ enabled: true, clarity: 100, theme: 'light', reducedTransparency: true });
    glass.render(.3, 0);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    expect(glass.getDiagnostics()).toMatchObject({ mode: 'solid', width: 1, height: 1, blurWidth: 1, blurHeight: 1 });
    glass.dispose();
  });
  it('falls back without repeated failing allocations or damaging the world render state', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = {
      capabilities: { maxTextureSize: 4096 }, autoClear: true,
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 1000), getPixelRatio: () => 1,
      getViewport: (v: THREE.Vector4) => v.set(0, 0, 800, 1000),
      getScissor: (v: THREE.Vector4) => v.set(0, 0, 800, 1000), getScissorTest: () => true,
      getRenderTarget: () => null, setRenderTarget: vi.fn(), setViewport: vi.fn(),
      setScissor: vi.fn(), setScissorTest: vi.fn(), copyFramebufferToTexture: vi.fn(() => { throw new Error('copy unavailable'); }), render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const glass = new GlassWorldCompositor(renderer);
    glass.setPreference({ enabled: true, clarity: 50, theme: 'light', reducedTransparency: false });
    glass.render(.3, 0); glass.render(.3, 0);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.autoClear).toBe(true);
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(glass.getDiagnostics()).toMatchObject({ mode: 'css', width: 1, height: 1 });
    glass.dispose(); warning.mockRestore();
  });
});
