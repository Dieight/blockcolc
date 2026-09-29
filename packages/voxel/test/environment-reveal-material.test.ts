import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cloneEnvironmentRevealMaterial } from "../src/environment-reveal-material";

describe("environment reveal material cloning", () => {
  it("preserves shader hooks while keeping reveal opacity and disposal independent", () => {
    const source = new THREE.MeshStandardMaterial({ opacity: 0.7 });
    const beforeCompile: THREE.Material["onBeforeCompile"] = (shader) => { shader.uniforms.testRevealHook = { value: 1 }; };
    const cacheKey = () => "atlas-with-custom-shader-hooks";
    source.onBeforeCompile = beforeCompile;
    source.customProgramCacheKey = cacheKey;
    let sourceDisposals = 0;
    source.addEventListener("dispose", () => { sourceDisposals += 1; });
    const clone = cloneEnvironmentRevealMaterial(source);
    clone.opacity = 0;

    expect(clone).not.toBe(source);
    expect(clone.onBeforeCompile).toBe(beforeCompile);
    expect(clone.customProgramCacheKey).toBe(cacheKey);
    expect(clone.customProgramCacheKey()).toBe("atlas-with-custom-shader-hooks");
    expect(source.opacity).toBe(0.7);
    expect(clone.opacity).toBe(0);
    clone.dispose();
    expect(sourceDisposals).toBe(0);
    source.dispose();
    expect(sourceDisposals).toBe(1);
  });
});
