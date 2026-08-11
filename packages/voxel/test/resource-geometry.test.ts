import type { AtlasBlockGeometry, AtlasGeometryFaceReference, BlockFace, ResourcePackManifest } from "@tomato-clock/resource-pack";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import {
  batchGeometryPlans,
  applyGeometryMeshRenderPolicy,
  compileMappedGeometryVoxel,
  compileMappedGeometryVoxelPages,
  createAtlasGeometry,
  createAtlasGeometryCutoutDepthMaterial,
  createAtlasGeometryMaterial,
  createGeometryBatches,
  disposeAtlasGeometryMeshResources,
  geometryVoxelCacheKey,
  isP1GeometryBlock,
  isP2GeometryBlock,
  isSupportedGeometryBlock,
  MAX_GEOMETRY_BATCHES,
  planGeometryVoxel,
} from "../src/resource-geometry";
import type { ResourcePackAtlas, ResourcePackAtlasPage } from "../src/resource-textures";

describe("P1/P2 geometry signature planning", () => {
  it("limits the renderer gate to the explicitly supported Minecraft P1 families", () => {
    expect(isP1GeometryBlock("minecraft:oak_slab", { type: "bottom" })).toBe(true);
    expect(isP1GeometryBlock("minecraft:oak_stairs", { shape: "straight" })).toBe(true);
    expect(isP1GeometryBlock("minecraft:oak_trapdoor", { open: "true" })).toBe(true);
    expect(isP1GeometryBlock("minecraft:oak_door", { half: "lower" })).toBe(true);
    expect(isP1GeometryBlock("minecraft:oak_stairs", {})).toBe(false);
    expect(isP1GeometryBlock("minecraft:oak_stairs", { shape: "inner_left" })).toBe(false);
    expect(isP1GeometryBlock("minecraft:oak_stairs", { shape: "outer_right" })).toBe(false);
    expect(isP1GeometryBlock("acme:oak_slab", { type: "bottom" })).toBe(false);
    expect(isP1GeometryBlock("minecraft:hopper", {})).toBe(false);
    expect(isP2GeometryBlock("minecraft:cobblestone_wall")).toBe(true);
    expect(isP2GeometryBlock("minecraft:oak_fence")).toBe(true);
    expect(isP2GeometryBlock("minecraft:glass_pane")).toBe(true);
    expect(isP2GeometryBlock("minecraft:iron_bars")).toBe(true);
    expect(isP2GeometryBlock("minecraft:oak_fence_gate")).toBe(false);
    expect(isP2GeometryBlock("custom:oak_fence")).toBe(false);
    expect(isSupportedGeometryBlock("minecraft:glass_pane")).toBe(true);
    expect(geometryVoxelCacheKey(voxel("minecraft:oak_stairs", 0, { waterlogged: "false", shape: "straight" }))).toBe(
      geometryVoxelCacheKey(voxel("minecraft:oak_stairs", 1, { shape: "straight", waterlogged: "false" })),
    );
  });

  it("keeps signatures stable across texture IDs while preserving the slot pattern", () => {
    const first = compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(3, 7))!;
    const second = compileMappedGeometryVoxel(voxel("minecraft:stone_slab", 1), slabGeometry(18, 22))!;

    expect(first.topology.signature).toBe(second.topology.signature);
    expect(first.topology.signature).toMatch(/^geo:[0-9a-f]{16}$/);
    expect(first.topology.canonicalPayload).toBe(second.topology.canonicalPayload);
    expect(first.faceTiles.slice(0, 2)).toEqual([7, 3]);
    expect(second.faceTiles.slice(0, 2)).toEqual([22, 18]);
    expect(first.topology.quads.map((quad) => quad.slot)).toEqual(second.topology.quads.map((quad) => quad.slot));
  });

  it("compiles all resolved multipart model elements into one exact topology", () => {
    const combined = compileMappedGeometryVoxel(
      voxel("minecraft:oak_fence", 0, { north: "true", east: "true" }),
      multipartFenceGeometry(),
    )!;
    const geometry = createAtlasGeometry(batchGeometryPlans([combined])[0]!);

    expect(combined.topology.elementCount).toBe(3);
    expect(combined.topology.quads).toHaveLength(14);
    expect(geometry.getAttribute("position").count).toBe(56);
    expect(geometry.getIndex()?.count).toBe(84);
    expect(combined.topology.quads.filter((quad) => quad.face === "east")).toHaveLength(2);
    geometry.dispose();
  });

  it("plans a resolved multipart block through the resource-pack contract", () => {
    const atlas = multipartAtlas();
    const plan = planGeometryVoxel(
      voxel("minecraft:oak_fence", 0, { north: "true", east: "true" }),
      multipartManifest(),
      atlas,
    );

    expect(plan?.topology.elementCount).toBe(3);
    expect(plan?.topology.quads).toHaveLength(14);
    expect(plan?.topology.textureSlotCount).toBe(1);
    atlas.dispose();
  });

  it("plans translucent stained glass panes as a dedicated geometry alpha batch", () => {
    const atlas = multipartAtlas("translucent");
    const plan = planGeometryVoxel(
      voxel("minecraft:red_stained_glass_pane", 0, { north: "true", east: "true" }),
      multipartManifest("minecraft:red_stained_glass_pane"),
      atlas,
    );

    expect(plan?.alphaMode).toBe("translucent");
    expect(batchGeometryPlans([plan!])[0]?.alphaMode).toBe("translucent");
    atlas.dispose();
  });

  it("keeps P2 batching state-specific and falls back atomically for an unsafe combined branch", () => {
    const northA = compileMappedGeometryVoxel(
      voxel("minecraft:oak_fence", 0, { north: "true" }),
      multipartFenceGeometry(false),
    )!;
    const northB = compileMappedGeometryVoxel(
      voxel("minecraft:spruce_fence", 1, { north: "true" }),
      multipartFenceGeometry(false, 8),
    )!;
    const northEast = compileMappedGeometryVoxel(
      voxel("minecraft:oak_fence", 2, { north: "true", east: "true" }),
      multipartFenceGeometry(),
    )!;
    const unsafe = multipartFenceGeometry();
    unsafe.elements[2]!.faces.east = face(12, "opaque", 1);

    expect(batchGeometryPlans([northA, northB, northEast])).toHaveLength(2);
    expect(compileMappedGeometryVoxel(voxel("minecraft:oak_fence"), unsafe)).toBeUndefined();
    expect(geometryVoxelCacheKey(northEast.voxel)).not.toBe(geometryVoxelCacheKey(northA.voxel));
  });

  it("builds only declared slab and stair faces without completing cuboids", () => {
    const slab = compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2))!;
    const stair = compileMappedGeometryVoxel(voxel("minecraft:oak_stairs", 0, { shape: "straight" }), stairGeometry())!;
    const slabBatch = batchGeometryPlans([slab])[0]!;
    const stairBatch = batchGeometryPlans([stair])[0]!;
    const slabBuffer = createAtlasGeometry(slabBatch);
    const stairBuffer = createAtlasGeometry(stairBatch);

    expect(slab.topology.quads).toHaveLength(6);
    expect(slabBuffer.getAttribute("position").count).toBe(24);
    expect(slabBuffer.getIndex()?.count).toBe(36);
    expect(stair.topology.quads).toHaveLength(8);
    expect(stairBuffer.getAttribute("position").count).toBe(32);
    expect(stairBuffer.getIndex()?.count).toBe(48);
    expect(stair.topology.quads.filter((quad) => quad.face === "up")).toHaveLength(1);

    slabBuffer.dispose();
    stairBuffer.dispose();
  });

  it("splits P1/P2 quads by atlas page while preserving one atomic voxel", () => {
    const mapped = slabGeometry(0, 0);
    for (const side of ["north", "south", "west", "east"] as const) {
      mapped.elements[0]!.faces[side]!.page = 1;
      mapped.elements[0]!.faces[side]!.textureIndex = 0;
    }
    const plans = compileMappedGeometryVoxelPages(voxel("minecraft:oak_slab"), mapped)!;
    const batches = batchGeometryPlans(plans);

    expect(plans.map((plan) => ({ page: plan.page, quads: plan.topology.quads.length }))).toEqual([
      { page: 0, quads: 2 },
      { page: 1, quads: 4 },
    ]);
    expect(batches.map((batch) => batch.page)).toEqual([0, 1]);
    let indexCount = 0;
    for (const batch of batches) {
      const geometry = createAtlasGeometry(batch);
      indexCount += geometry.getIndex()!.count;
      geometry.dispose();
    }
    expect(indexCount).toBe(36);
  });

  it("preserves a door as one thin five-face geometry", () => {
    const plan = compileMappedGeometryVoxel(voxel("minecraft:oak_door"), doorGeometry())!;
    const geometry = createAtlasGeometry(batchGeometryPlans([plan])[0]!);
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());

    expect(plan.topology.quads).toHaveLength(5);
    expect(geometry.getAttribute("position").count).toBe(20);
    expect(size.x).toBeCloseTo(0.97, 6);
    expect(size.y).toBeCloseTo(0.97, 6);
    expect(size.z).toBeCloseTo((3 / 16) * 0.97, 6);
    geometry.dispose();
  });

  it("rotates crossed unshaded planes into non-axis-aligned positions and normals", () => {
    const plan = compileMappedGeometryVoxel(voxel("minecraft:short_grass"), crossGeometry())!;
    const quad = plan.topology.quads[0]!;

    expect(quad.shade).toBe(false);
    expect(Math.abs(quad.normal[0])).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(quad.normal[2])).toBeCloseTo(Math.SQRT1_2, 6);
    expect(plan.topology.quads).toHaveLength(2);
    expect(new Set(quad.positions.filter((_value, index) => index % 3 === 0)).size).toBeGreaterThan(1);
    expect(new Set(quad.positions.filter((_value, index) => index % 3 === 2)).size).toBeGreaterThan(1);
  });

  it("batches by signature, material response, alpha and emissive state without using texture IDs", () => {
    const plainA = compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2))!;
    const plainB = compileMappedGeometryVoxel(voxel("minecraft:stone_slab", 1), slabGeometry(8, 9))!;
    const lit = compileMappedGeometryVoxel({ ...voxel("minecraft:oak_slab", 2), emissiveKind: "light", emissiveLevel: 12 }, slabGeometry(4, 5))!;
    const door = compileMappedGeometryVoxel(voxel("minecraft:oak_door", 3), doorGeometry())!;
    const translucent = compileMappedGeometryVoxel(voxel("minecraft:glass_pane", 4), slabGeometry(10, 11, "translucent"))!;
    const batches = batchGeometryPlans([plainA, plainB, lit, door, translucent]);

    expect(batches).toHaveLength(4);
    const shared = batches.find((batch) => batch.entries.includes(plainA))!;
    expect(shared.entries).toEqual([plainA, plainB]);
    const response = createAtlasGeometry(shared).getAttribute("instanceMaterialResponse");
    expect([response.getX(0), response.getX(1)]).toEqual([2, 1]);
    expect(batches.find((batch) => batch.entries.includes(lit))?.emissiveLevel).toBe(12);
    expect(batches.find((batch) => batch.entries.includes(door))?.alphaMode).toBe("cutout");
    expect(batches.find((batch) => batch.entries.includes(translucent))?.alphaMode).toBe("translucent");
  });

  it("caps scene geometry batches and falls excess shapes back atomically", () => {
    const manifest = manyShapeManifest(MAX_GEOMETRY_BATCHES + 1);
    const atlas = multipartAtlas();
    const voxels = Array.from({ length: MAX_GEOMETRY_BATCHES + 1 }, (_, index) => (
      voxel("minecraft:shape", index, { mode: String(index) })
    ));

    const result = createGeometryBatches(voxels, manifest, atlas);

    expect(result.batches).toHaveLength(MAX_GEOMETRY_BATCHES);
    expect(result.fallbackVoxels).toHaveLength(1);
    expect(result.batches.every((batch) => batch.entries.length === 1)).toBe(true);
    atlas.dispose();
  });

  it("uses 11 vertex slots including instanceMatrix and accepts bounded unshaded geometry", () => {
    const plan = compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2))!;
    const geometry = createAtlasGeometry(batchGeometryPlans([plan])[0]!);

    expect(Object.keys(geometry.attributes)).toEqual([
      "position", "normal", "uv", "faceSlot", "instanceFaceTilesA", "instanceFaceTilesB", "instanceFaceTintKinds",
      "instanceMaterialResponse",
    ]);
    expect(Object.keys(geometry.attributes).length + 4).toBe(12);
    expect(compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2, "translucent"))?.alphaMode).toBe("translucent");
    expect(compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2, "opaque", 0))).toBeUndefined();
    const unshaded = slabGeometry(1, 2);
    unshaded.elements[0]!.shade = false;
    expect(compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), unshaded)?.topology.quads.every((quad) => !quad.shade)).toBe(true);
    geometry.dispose();
  });

  it("uses the cube-path translucent material and renderer shadow policy", () => {
    const page = atlasPage();
    const material = createAtlasGeometryMaterial(page, "translucent");
    const opaqueMaterial = createAtlasGeometryMaterial(page, "opaque");
    const cutoutMaterial = createAtlasGeometryMaterial(page, "cutout");
    const geometry = createAtlasGeometry(batchGeometryPlans([
      compileMappedGeometryVoxel(voxel("minecraft:glass_pane"), slabGeometry(1, 2, "translucent"))!,
    ])[0]!);
    const mesh = new THREE.Mesh(geometry, material);
    const policy = applyGeometryMeshRenderPolicy(mesh, "translucent", true);

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.alphaTest).toBe(0);
    expect(material.roughness).toBe(0.16);
    expect(opaqueMaterial.transparent).toBe(false);
    expect(opaqueMaterial.depthWrite).toBe(true);
    expect(opaqueMaterial.alphaTest).toBe(0);
    expect(cutoutMaterial.transparent).toBe(false);
    expect(cutoutMaterial.depthWrite).toBe(true);
    expect(cutoutMaterial.alphaTest).toBe(0.5);
    expect(policy).toEqual({ castShadow: false, customDepthMaterial: "none" });
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.renderOrder).toBe(10);
    geometry.dispose();
    material.dispose();
    opaqueMaterial.dispose();
    cutoutMaterial.dispose();
    page.animationLookup!.texture.dispose();
    page.animationLookup!.blendTexture.dispose();
    page.texture.dispose();
  });

  it("shares animation lookup with visible and cutout depth shaders and disposes owned resources once", () => {
    const page = atlasPage();
    const plan = compileMappedGeometryVoxel(voxel("minecraft:oak_door"), doorGeometry())!;
    const geometry = createAtlasGeometry(batchGeometryPlans([plan])[0]!);
    const material = createAtlasGeometryMaterial(page, "cutout");
    const depth = createAtlasGeometryCutoutDepthMaterial(page);
    const vertexShader = "#include <common>\nvoid main(){\n#include <uv_vertex>\n}";
    const fragmentShader = "#include <common>\nvoid main(){\n#include <map_fragment>\n}";
    const visibleShader = { uniforms: {}, vertexShader, fragmentShader };
    const depthShader = { uniforms: {}, vertexShader, fragmentShader };
    material.onBeforeCompile(visibleShader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    depth.onBeforeCompile(depthShader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(visibleShader.vertexShader).toContain("texture2D(blockcolcAnimationLookup");
    expect(depthShader.vertexShader).toContain("texture2D(blockcolcAnimationLookup");
    expect(visibleShader.fragmentShader).toContain("mix(sampledDiffuseColor, blockcolcNextDiffuseColor");
    expect(depthShader.fragmentShader).toContain("mix(sampledDiffuseColor, blockcolcNextDiffuseColor");
    expect(visibleShader.uniforms).toMatchObject({ blockcolcAnimationBlendLookup: { value: page.animationLookup!.blendTexture } });
    expect(visibleShader.fragmentShader).toContain("diffuseColor.rgb *= vBlockcolcTint;");
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.ownedMaterial = material;
    mesh.userData.ownedDepthMaterial = depth;
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const depthDispose = vi.spyOn(depth, "dispose");

    disposeAtlasGeometryMeshResources(mesh);
    disposeAtlasGeometryMeshResources(mesh);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(depthDispose).toHaveBeenCalledTimes(1);
    page.animationLookup!.texture.dispose();
    page.animationLookup!.blendTexture.dispose();
    page.texture.dispose();
  });
});

function voxel(sourceBlockId: string, x = 0, sourceBlockState: Record<string, string> = {}): BlueprintVoxel {
  return { x, y: 0, z: 0, materialId: "wood", buildOrder: 10_000, sourceBlockId, sourceBlockState };
}

function slabGeometry(
  sideTile: number,
  capTile: number,
  alphaMode: "opaque" | "cutout" | "translucent" = "opaque",
  tintIndex?: number,
): AtlasBlockGeometry {
  return {
    status: "resolved_geometry",
    modelId: "minecraft:block/slab",
    elements: [{
      from: [0, 0, 0],
      to: [16, 8, 16],
      shade: true,
      faces: {
        down: face(capTile, alphaMode, tintIndex),
        up: face(capTile, alphaMode, tintIndex),
        north: face(sideTile, alphaMode, tintIndex, [0, 0.5, 1, 1]),
        south: face(sideTile, alphaMode, tintIndex, [0, 0.5, 1, 1]),
        west: face(sideTile, alphaMode, tintIndex, [0, 0.5, 1, 1]),
        east: face(sideTile, alphaMode, tintIndex, [0, 0.5, 1, 1]),
      },
    }],
  };
}

function stairGeometry(): AtlasBlockGeometry {
  return {
    status: "resolved_geometry",
    modelId: "minecraft:block/stairs",
    elements: [
      {
        from: [0, 0, 0], to: [16, 8, 16], shade: true,
        faces: { down: face(1), north: face(2), south: face(2), west: face(2), east: face(2) },
      },
      {
        from: [0, 8, 8], to: [16, 16, 16], shade: true,
        faces: { up: face(1), north: face(2), south: face(2) },
      },
    ],
  };
}

function doorGeometry(): AtlasBlockGeometry {
  return {
    status: "resolved_geometry",
    modelId: "minecraft:block/door_bottom_left",
    elements: [{
      from: [0, 0, 0], to: [16, 16, 3], shade: true,
      faces: { down: face(4, "cutout"), up: face(4, "cutout"), north: face(4, "cutout"), west: face(4, "cutout"), east: face(4, "cutout") },
    }],
  };
}

function crossGeometry(): AtlasBlockGeometry {
  return {
    status: "resolved_geometry",
    modelId: "minecraft:block/cross",
    elements: [{
      from: [0, 0, 8], to: [16, 16, 8], shade: false,
      rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true },
      faces: {
        down: face(1, "cutout"), up: face(1, "cutout"),
        north: face(1, "cutout"), south: face(1, "cutout"),
        west: face(1, "cutout"), east: face(1, "cutout"),
      },
    }],
  };
}

function multipartFenceGeometry(includeEast = true, textureOffset = 0): AtlasBlockGeometry {
  const elements: AtlasBlockGeometry["elements"] = [
    {
      from: [6, 0, 6], to: [10, 16, 10], shade: true,
      faces: { down: face(textureOffset + 1), up: face(textureOffset + 1), north: face(textureOffset + 1), south: face(textureOffset + 1), west: face(textureOffset + 1), east: face(textureOffset + 1) },
    },
    {
      from: [7, 6, 0], to: [9, 15, 6], shade: true,
      faces: { down: face(textureOffset + 1), up: face(textureOffset + 1), north: face(textureOffset + 1), west: face(textureOffset + 1) },
    },
  ];
  if (includeEast) {
    elements.push({
      from: [10, 6, 7], to: [16, 15, 9], shade: true,
      faces: { down: face(textureOffset + 1), up: face(textureOffset + 1), south: face(textureOffset + 1), east: face(textureOffset + 1) },
    });
  }
  return { status: "resolved_geometry", modelId: "minecraft:block/oak_fence#multipart", elements };
}

function multipartManifest(blockId = "minecraft:oak_fence"): ResourcePackManifest {
  const model = (resourceId: string, from: readonly [number, number, number], to: readonly [number, number, number], faceNames: readonly BlockFace[]) => ({
    resourceId,
    archivePath: `assets/minecraft/models/${resourceId.slice("minecraft:".length)}.json`,
    textures: { texture: "minecraft:block/oak_planks" },
    elements: [{
      from,
      to,
      shade: true,
      faces: Object.fromEntries(faceNames.map((faceName) => [faceName, {
        texture: "#texture",
        uv: [0, 0, 16, 16] as const,
        rotation: 0 as const,
      }])),
    }],
  });
  const reference = (name: string) => ({ model: `minecraft:block/${name}`, x: 0 as const, y: 0 as const, uvlock: false, weight: 1 });
  return {
    schemaVersion: 1,
    pack: { packFormat: 15, description: "voxel multipart contract" },
    textures: [{
      resourceId: "minecraft:block/oak_planks", namespace: "minecraft", texturePath: "oak_planks",
      archivePath: "assets/minecraft/textures/block/oak_planks.png", width: 16, height: 16, png: new Uint8Array(),
    }],
    blockStates: [{
      resourceId: blockId, archivePath: `assets/minecraft/blockstates/${blockId.slice("minecraft:".length)}.json`, variants: [],
      multipart: [
        { when: { clauses: [{}] }, apply: [reference("fence_post")] },
        { when: { clauses: [{ north: ["true"] }] }, apply: [reference("fence_north")] },
        { when: { clauses: [{ east: ["true"] }] }, apply: [reference("fence_east")] },
      ],
    }],
    models: [
      model("minecraft:block/fence_post", [6, 0, 6], [10, 16, 10], ["down", "up", "north", "south", "west", "east"]),
      model("minecraft:block/fence_north", [7, 6, 0], [9, 15, 6], ["down", "up", "north", "west"]),
      model("minecraft:block/fence_east", [10, 6, 7], [16, 15, 9], ["down", "up", "south", "east"]),
    ],
    summary: { archiveFileCount: 5, candidateTextureCount: 1, acceptedTextureCount: 1, rejectedTextureCount: 0, ignoredFileCount: 0, namespaces: ["minecraft"], issues: [] },
  };
}

function manyShapeManifest(count: number): ResourcePackManifest {
  const reference = (index: number) => ({
    model: `minecraft:block/shape_${index}`, x: 0 as const, y: 0 as const, uvlock: false, weight: 1,
  });
  return {
    ...multipartManifest("minecraft:shape"),
    blockStates: [{
      resourceId: "minecraft:shape",
      archivePath: "assets/minecraft/blockstates/shape.json",
      variants: Array.from({ length: count }, (_, index) => ({
        key: `mode=${index}`, conditions: { mode: String(index) }, choices: [reference(index)],
      })),
    }],
    models: Array.from({ length: count }, (_, index) => ({
      resourceId: `minecraft:block/shape_${index}`,
      archivePath: `assets/minecraft/models/block/shape_${index}.json`,
      textures: { texture: "minecraft:block/oak_planks" },
      elements: [{
        from: [0, 0, 0] as const,
        to: [16, 1 + index / count, 16] as const,
        shade: true,
        faces: {
          north: { texture: "#texture", uv: [0, 0, 16, 16] as const, rotation: 0 as const },
        },
      }],
    })),
  };
}

function multipartAtlas(alphaMode: "opaque" | "cutout" | "translucent" = "opaque"): ResourcePackAtlas {
  const texture = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16);
  return {
    pages: [{ texture, width: 16, height: 16, columns: 1, cellSize: 16, padding: 0 }],
    tiles: new Map([["minecraft:block/oak_planks", {
      resourceId: "minecraft:block/oak_planks", index: 0, page: 0, pageTextureIndex: 0, alphaMode,
    }]]),
    source: {
      schemaVersion: 1, textureSize: 16, gutter: 0, safeMipLevels: 0,
      pages: [{ index: 0, width: 16, height: 16, columns: 1, rows: 1, rgba: new Uint8Array(16 * 16 * 4) }],
      entries: [{
        resourceId: "minecraft:block/oak_planks", index: 0, page: 0, pageTextureIndex: 0, x: 0, y: 0, width: 16, height: 16,
        uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, alphaMode,
      }],
    },
    dispose: () => texture.dispose(),
  };
}

function face(
  textureIndex: number,
  alphaMode: "opaque" | "cutout" | "translucent" = "opaque",
  tintIndex?: number,
  cropUv: readonly [number, number, number, number] = [0, 0, 1, 1],
): AtlasGeometryFaceReference {
  return {
    textureIndex,
    page: 0,
    uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
    alphaMode,
    cropUv,
    rotation: 0,
    ...(tintIndex === undefined ? {} : { tintIndex }),
  };
}

function atlasPage(): ResourcePackAtlasPage {
  const texture = new THREE.DataTexture(new Uint8Array(32 * 16 * 4), 32, 16);
  const pixels = new Uint8Array([0, 0, 0, 255, 1, 0, 0, 255]);
  const lookup = new THREE.DataTexture(pixels, 2, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
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
      texture: lookup,
      pixels,
      blendTexture,
      blendPixels,
      width: 2,
      height: 1,
      tileCount: 2,
      sequences: [{ textureIndex: 0, totalTicks: 2, interpolate: false, frames: [{ textureIndex: 0, time: 1 }, { textureIndex: 1, time: 1 }] }],
    },
  };
}
