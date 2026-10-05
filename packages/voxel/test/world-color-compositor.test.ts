import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WorldColorCompositor } from '../src/world-color-compositor';

function fakeRenderer() {
  return {
    capabilities: { maxTextureSize: 4096 }, autoClear: true,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 1000), getPixelRatio: () => 2,
    getViewport: (v: THREE.Vector4) => v.set(4, 5, 400, 500), getScissor: (v: THREE.Vector4) => v.set(2, 3, 4, 5),
    getScissorTest: () => true, getRenderTarget: () => null,
    setRenderTarget: vi.fn(), setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(),
    copyFramebufferToTexture: vi.fn(), render: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
}
describe('final-world colour compositor', () => {
  it('has no copy/draw cost with default or reset settings; grades only the world', () => {
    const renderer = fakeRenderer(), grade = new WorldColorCompositor(renderer);
    expect(grade.render()).toBe(false); expect(renderer.render).not.toHaveBeenCalled();
    grade.setPreference({ saturation: 135, brightness: 90, contrast: 110 });
    expect(grade.render()).toBe(true);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.setViewport).toHaveBeenCalledWith(0, 0, 400, 500);
    expect(renderer.setViewport).toHaveBeenLastCalledWith(new THREE.Vector4(4, 5, 400, 500));
    expect(renderer.setScissor).toHaveBeenLastCalledWith(new THREE.Vector4(2, 3, 4, 5));
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true); expect(renderer.autoClear).toBe(true);
    const texture = vi.mocked(renderer.copyFramebufferToTexture).mock.calls[0]![0];
    const dispose = vi.spyOn(texture, 'dispose');
    grade.setPreference(null); expect(dispose).toHaveBeenCalledTimes(1);
    expect(grade.render()).toBe(false); expect(renderer.render).toHaveBeenCalledTimes(1);
    grade.dispose();
  });
  it('does not retry a broken GPU operation or corrupt the next world/glass frame', () => {
    const renderer = fakeRenderer(), grade = new WorldColorCompositor(renderer);
    vi.mocked(renderer.copyFramebufferToTexture).mockImplementation(() => { throw Error('context unavailable'); });
    grade.setPreference({ saturation: 120, brightness: 100, contrast: 100 });
    expect(grade.render()).toBe(false); expect(grade.render()).toBe(false);
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.setViewport).toHaveBeenLastCalledWith(new THREE.Vector4(4, 5, 400, 500));
    expect(renderer.autoClear).toBe(true); grade.dispose();
  });
  it('does not allocate a framebuffer above device limits', () => {
    const renderer = fakeRenderer(), grade = new WorldColorCompositor(renderer);
    renderer.capabilities.maxTextureSize = 512;
    grade.setPreference({ saturation: 150, brightness: 100, contrast: 100 });
    expect(grade.render()).toBe(false); expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled(); grade.dispose();
  });
});
