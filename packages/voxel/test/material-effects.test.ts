import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { applyMaterialEffects } from "../src/material-effects";

describe("voxel material effects", () => {
  it("composes with an existing shader hook and cache key", () => {
    const material = new THREE.MeshStandardMaterial();
    const previousHook = vi.fn((shader: FakeShader) => {
      shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n// atlas-patch");
    });
    material.onBeforeCompile = previousHook as typeof material.onBeforeCompile;
    material.customProgramCacheKey = () => "atlas-v1";

    applyMaterialEffects(material);
    const shader = fakeShader();
    compile(material, shader);

    expect(previousHook).toHaveBeenCalledTimes(1);
    expect(shader.vertexShader).toContain("// atlas-patch");
    expect(shader.vertexShader).toContain("vBlockcolcEffectNormal");
    expect(shader.fragmentShader).toContain("blockcolcEffectShadowTint");
    expect(shader.fragmentShader).toContain("blockcolcEffectEdgeStrength");
    expect(shader.fragmentShader).toContain("outgoingLight *=");
    expect(material.customProgramCacheKey()).toBe("atlas-v1|blockcolc-material-effects-v1");
  });

  it("is idempotent and keeps one stable program key", () => {
    const material = new THREE.MeshStandardMaterial();
    const first = applyMaterialEffects(material);
    const key = material.customProgramCacheKey();
    const second = applyMaterialEffects(material, { strength: 0.42 });
    const shader = fakeShader();
    compile(material, shader);

    expect(second).toBe(first);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(shader.vertexShader.match(/blockcolc-material-effects-v1/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/blockcolc-material-effects-v1/g)).toHaveLength(1);
    expect(first.uniforms.blockcolcEffectStrength.value).toBe(0.42);
  });

  it("updates shared uniforms without recompiling the patch", () => {
    const material = new THREE.MeshStandardMaterial();
    const patch = applyMaterialEffects(material);
    const shader = fakeShader();
    compile(material, shader);
    const key = material.customProgramCacheKey();

    patch.update({
      lightDirection: [2, 0, 0],
      lightTint: 0xffaa77,
      shadowTint: 0x6677aa,
      strength: 2,
      edgeStrength: 0.2,
    });

    expect(shader.uniforms.blockcolcEffectLightDirection).toBe(patch.uniforms.blockcolcEffectLightDirection);
    expect(patch.uniforms.blockcolcEffectLightDirection.value.toArray()).toEqual([1, 0, 0]);
    expect(patch.uniforms.blockcolcEffectLightTint.value.getHex()).toBe(0xffaa77);
    expect(patch.uniforms.blockcolcEffectShadowTint.value.getHex()).toBe(0x6677aa);
    expect(patch.uniforms.blockcolcEffectStrength.value).toBe(1);
    expect(patch.uniforms.blockcolcEffectEdgeStrength.value).toBe(0.2);
    expect(material.customProgramCacheKey()).toBe(key);
  });
});

interface FakeShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

function fakeShader(): FakeShader {
  return {
    vertexShader: "#include <common>\n#include <beginnormal_vertex>\n#include <uv_vertex>",
    fragmentShader: "#include <common>\n#include <opaque_fragment>",
    uniforms: {},
  };
}

function compile(material: THREE.MeshStandardMaterial, shader: FakeShader): void {
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
}
