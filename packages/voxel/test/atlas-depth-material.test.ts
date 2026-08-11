import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  atlasShadowPolicy,
  createAtlasCutoutDepthMaterial,
  disposeAtlasDepthMaterial,
} from "../src/atlas-depth-material";
import type { ResourcePackAtlasPage } from "../src/resource-textures";

describe("atlas cutout depth material", () => {
  it("expresses opaque, cutout, and translucent shadow policies", () => {
    expect(atlasShadowPolicy("opaque")).toEqual({ castShadow: true, customDepthMaterial: "none" });
    expect(atlasShadowPolicy("cutout")).toEqual({ castShadow: true, customDepthMaterial: "atlas-cutout" });
    expect(atlasShadowPolicy("translucent")).toEqual({ castShadow: false, customDepthMaterial: "none" });
  });

  it("uses the visible atlas map and alpha threshold without taking texture ownership", () => {
    const page = atlasPage();
    const material = createAtlasCutoutDepthMaterial(page);

    expect(material).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(material.map).toBe(page.texture);
    expect(material.alphaTest).toBe(0.5);
    expect(material.customProgramCacheKey()).toBe("blockcolc-atlas-cutout-depth-v4-static");

    const textureDispose = vi.spyOn(page.texture, "dispose");
    disposeAtlasDepthMaterial(material);
    expect(textureDispose).not.toHaveBeenCalled();
    page.texture.dispose();
  });

  it("patches depth UVs with the same six-face instance attributes as the visible atlas material", () => {
    const page = atlasPage();
    const material = createAtlasCutoutDepthMaterial(page, 0.42);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };

    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(material.alphaTest).toBe(0.42);
    expect(shader.vertexShader).toContain("attribute float faceSlot;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceTilesA;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceTilesB;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordA0;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordA1;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordB0;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordB1;");
    expect(shader.vertexShader).toContain("attribute float instanceFaceTintKinds;");
    expect(shader.vertexShader).toContain("faceSlot < 0.5 ? instanceFaceTilesA.x");
    expect(shader.vertexShader).toContain("faceSlot < 4.5 ? instanceFaceTilesB.y : instanceFaceTilesB.z");
    expect(shader.vertexShader).toContain("/ 2047.0");
    expect(shader.vertexShader).toContain("/ 4194304.0");
    expect(shader.vertexShader).toContain("blockcolcRotation > 2.5");
    expect(shader.vertexShader).toContain("blockcolcRotation > 1.5");
    expect(shader.vertexShader).toContain("blockcolcRotation > 0.5");
    expect(shader.vertexShader).toContain("blockcolcCropDirection");
    expect(shader.vertexShader).toContain("vMapUv = (vec2(blockcolcColumn, blockcolcRow)");
    expect(shader.uniforms).toMatchObject({
      blockcolcAtlasColumns: { value: page.columns },
      blockcolcAtlasCellSize: { value: page.cellSize },
      blockcolcAtlasPadding: { value: page.padding },
    });
    expect((shader.uniforms as Record<string, { value: unknown }>).blockcolcAtlasSize?.value).toEqual(
      new THREE.Vector2(page.width, page.height),
    );

    disposeAtlasDepthMaterial(material);
    page.texture.dispose();
  });

  it("uses the shared animated-tile lookup for cutout shadow sampling", () => {
    const page = atlasPage(true);
    const material = createAtlasCutoutDepthMaterial(page);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };

    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(material.customProgramCacheKey()).toBe("blockcolc-atlas-cutout-depth-v4-animated");
    expect(shader.vertexShader).toContain("texture2D(blockcolcAnimationLookup");
    expect(shader.fragmentShader).toContain("mix(sampledDiffuseColor, blockcolcNextDiffuseColor");
    expect(shader.uniforms).toMatchObject({
      blockcolcAnimationLookup: { value: page.animationLookup!.texture },
      blockcolcAnimationBlendLookup: { value: page.animationLookup!.blendTexture },
    });
    disposeAtlasDepthMaterial(material);
    page.animationLookup!.texture.dispose();
    page.animationLookup!.blendTexture.dispose();
    page.texture.dispose();
  });

  it("disposes the owned material idempotently", () => {
    const page = atlasPage();
    const material = createAtlasCutoutDepthMaterial(page);
    const dispose = vi.spyOn(material, "dispose");

    disposeAtlasDepthMaterial(material);
    disposeAtlasDepthMaterial(material);

    expect(dispose).toHaveBeenCalledTimes(1);
    page.texture.dispose();
  });
});

function atlasPage(animated = false): ResourcePackAtlasPage {
  const texture = new THREE.DataTexture(new Uint8Array(32 * 16 * 4), 32, 16);
  if (!animated) return { texture, width: 32, height: 16, columns: 2, cellSize: 16, padding: 0 };
  const pixels = new Uint8Array([0, 0, 0, 255, 1, 0, 0, 255]);
  const lookupTexture = new THREE.DataTexture(pixels, 2, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  const blendPixels = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]);
  const blendTexture = new THREE.DataTexture(blendPixels, 2, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  return {
    texture,
    width: 32,
    height: 16,
    columns: 2,
    cellSize: 16,
    padding: 0,
    animationLookup: {
      texture: lookupTexture,
      pixels,
      blendTexture,
      blendPixels,
      width: 2,
      height: 1,
      tileCount: 2,
      sequences: [{
        textureIndex: 0,
        totalTicks: 2,
        interpolate: false,
        frames: [{ textureIndex: 0, time: 1 }, { textureIndex: 1, time: 1 }],
      }],
    },
  };
}
