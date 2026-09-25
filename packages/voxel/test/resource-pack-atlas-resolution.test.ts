import { strToU8, zipSync, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { layerResourcePackManifests, parseJava16xResourcePack } from "@tomato-clock/resource-pack";
import { buildResourcePackAtlas, createAtlasMaterial } from "../src/resource-textures";
import { createAtlasGeometryMaterial } from "../src/resource-geometry";

describe("page-local texture resolution", () => {
  it("uses each page's tile size in cube and geometry shader UV uniforms", () => {
    const base = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "low resolution" } }),
      "assets/minecraft/textures/block/low.png": rgbaPng(16, 16, [20, 30, 40, 255]),
    }));
    const overlay = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "high resolution" } }),
      "assets/minecraft/textures/block/high.png": rgbaPng(256, 256, [50, 60, 70, 255]),
    }));
    const lowAtlas = buildResourcePackAtlas(base);
    let mixedAtlas: ReturnType<typeof buildResourcePackAtlas> | undefined;
    const materials: THREE.Material[] = [];
    try {
      mixedAtlas = buildResourcePackAtlas(layerResourcePackManifests(base, overlay));
      const lowPage = mixedAtlas.pages.find((page) => page.textureSize === 16)!;
      const highPage = mixedAtlas.pages.find((page) => page.textureSize === 256)!;
      expect(lowPage.cellSize).toBe(20);
      expect(highPage.cellSize).toBe(260);
      expect(mixedAtlas.tiles.get("minecraft:block/low")?.page).toBe(mixedAtlas.source.entries.find((entry) => entry.resourceId === "minecraft:block/low")?.page);

      for (const [page, expectedCell] of [[lowPage, 20], [highPage, 260]] as const) {
        const cubeMaterial = createAtlasMaterial(page, "opaque");
        const geometryMaterial = createAtlasGeometryMaterial(page, "opaque");
        materials.push(cubeMaterial, geometryMaterial);
        const cubeShader = compileMaterial(cubeMaterial);
        const geometryShader = compileMaterial(geometryMaterial);
        expect((cubeShader.uniforms.blockcolcAtlasCellSize!.value as number)).toBe(expectedCell);
        expect((geometryShader.uniforms.blockcolcAtlasCellSize!.value as number)).toBe(expectedCell);
        expect(cubeShader.vertexShader).toContain("vec2(blockcolcColumn, blockcolcRow) * blockcolcAtlasCellSize");
        expect(geometryShader.vertexShader).toContain("vec2(blockcolcColumn, blockcolcRow) * blockcolcAtlasCellSize");
      }

      const priorEstimate = lowAtlas.source.memoryEstimate!;
      const priorResidentBytes = priorEstimate.sourcePngBytes + priorEstimate.pageRgbaBytes
        + priorEstimate.mipmapRgbaBytes + priorEstimate.animationLookupRgbaBytes + priorEstimate.estimatedGpuBytes;
      expect(mixedAtlas.source.memoryEstimate!.reservedAtlasBytes - priorEstimate.reservedAtlasBytes).toBe(priorResidentBytes);
      expect(mixedAtlas.source.memoryEstimate!.estimatedPeakBytes).toBeLessThanOrEqual(
        mixedAtlas.source.memoryEstimate!.limitBytes,
      );
    } finally {
      for (const material of materials) material.dispose();
      mixedAtlas?.dispose();
      lowAtlas.dispose();
    }
  });
});

function compileMaterial(material: THREE.Material): THREE.WebGLProgramParametersWithUniforms {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <uv_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>",
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function rgbaPng(width: number, height: number, color: readonly number[]): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const rowBytes = width * 4;
  const scanlines = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (rowBytes + 1);
    for (let x = 0; x < width; x += 1) scanlines.set(color, row + 1 + x * 4);
  }
  return joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(joinBytes(typeBytes, data)), false);
  return output;
}

function joinBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
