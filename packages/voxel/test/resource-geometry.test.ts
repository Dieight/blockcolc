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
  planGeometryVoxelPages,
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
    expect(compileMappedGeometryVoxel(voxel("example:oak_fence"), unsafe)).toBeUndefined();
    expect(geometryVoxelCacheKey(northEast.voxel)).not.toBe(geometryVoxelCacheKey(northA.voxel));
  });

  it("resolves vanilla state tint per geometry instance and splits uniform batches by color", () => {
    const redstone0 = compileMappedGeometryVoxel(
      voxel("minecraft:redstone_wire", 0, { power: "0" }), slabGeometry(1, 2, "opaque", 0),
    )!;
    const redstone15 = compileMappedGeometryVoxel(
      voxel("minecraft:redstone_wire", 1, { power: "15" }), slabGeometry(1, 2, "opaque", 0),
    )!;
    const melon0 = compileMappedGeometryVoxel(
      voxel("minecraft:melon_stem", 2, { age: "0" }), slabGeometry(1, 2, "opaque", 0),
    )!;
    const pumpkin7 = compileMappedGeometryVoxel(
      voxel("minecraft:pumpkin_stem", 3, { age: "7" }), slabGeometry(1, 2, "opaque", 0),
    )!;
    const attached = compileMappedGeometryVoxel(
      voxel("minecraft:attached_pumpkin_stem", 4, { facing: "north" }), slabGeometry(1, 2, "opaque", 0),
    )!;
    const plans = [redstone0, redstone15, melon0, pumpkin7, attached];
    const batches = batchGeometryPlans(plans);

    expect(plans.map((plan) => plan.stateTintRgb)).toEqual([0x4c0000, 0xff3200, 0x00ff00, 0xe0c71c, 0xe0c71c]);
    expect(new Set(batches.map((batch) => batch.stateTintRgb))).toEqual(new Set([0x4c0000, 0xff3200, 0x00ff00, 0xe0c71c]));
    expect(batches.find((batch) => batch.stateTintRgb === 0x4c0000)?.entries).toEqual([redstone0]);
    expect(batches.find((batch) => batch.stateTintRgb === 0xff3200)?.entries).toEqual([redstone15]);
    expect(batches.find((batch) => batch.stateTintRgb === 0xe0c71c)?.entries).toEqual([pumpkin7, attached]);

    const page = atlasPage();
    const material = createAtlasGeometryMaterial(page, "opaque", "default", 0xff3200);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main(){\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main(){\n#include <map_fragment>\n}",
    };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    const geometry = createAtlasGeometry(batches.find((batch) => batch.stateTintRgb === 0xff3200)!);

    expect(shader.uniforms).toMatchObject({ blockcolcStateTint: { value: new THREE.Color(0xff3200) } });
    expect(shader.vertexShader).toContain("blockcolcTintKind < 10.5 ? blockcolcStateTint");
    expect(Object.keys(geometry.attributes).length + 4).toBe(15);
    geometry.dispose();
    material.dispose();
    page.animationLookup!.texture.dispose();
    page.animationLookup!.blendTexture.dispose();
    page.texture.dispose();
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

  it("uses reversed element bounds for winding while keeping AO face and shade override separate", () => {
    const reversed = slabGeometry(1, 2);
    reversed.elements[0]!.from = [16, 0, 0];
    reversed.elements[0]!.to = [0, 8, 16];
    reversed.elements[0]!.shadeDirectionOverride = "north";
    const plan = compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), reversed)!;
    const north = plan.topology.quads.find((quad) => quad.face === "north")!;
    const buffer = createAtlasGeometry(batchGeometryPlans([plan])[0]!);

    expect(north.positions.slice(0, 6)).toEqual([0, 0, 0, 16, 0, 0]);
    expect(north.normal).toEqual([0, 0, 1]);
    expect(north.faceOcclusionSlot).toBe(2);
    expect(north.shadeFactor).toBe(0.8);
    expect(new Set(plan.topology.quads.map((quad) => quad.shadeFactor))).toEqual(new Set([0.8]));
    expect(buffer.getAttribute("faceOcclusionSlot").getX(0)).toBe(plan.topology.quads[0]!.faceOcclusionSlot);
    expect(buffer.getAttribute("faceShadeFactor").getX(0)).toBeCloseTo(plan.topology.quads[0]!.shadeFactor, 6);
    buffer.dispose();
  });

  it("rotates the vault's 26.3 inverted cage through Y facings and preserves winding under X rotation", () => {
    const rotations = [
      { x: 0 as const, y: 90 as const, face: "west" as const, normal: [1, 0, 0] as const, faceSlot: 4, shadeFactor: 0.6 },
      { x: 0 as const, y: 180 as const, face: "south" as const, normal: [0, 0, -1] as const, faceSlot: 3, shadeFactor: 0.8 },
      { x: 0 as const, y: 270 as const, face: "east" as const, normal: [-1, 0, 0] as const, faceSlot: 5, shadeFactor: 0.6 },
      { x: 90 as const, y: 0 as const, face: "up" as const, normal: [0, -1, 0] as const, faceSlot: 1, shadeFactor: 1 },
    ];
    const from = [15.998, 3.002, 0.002] as const;
    const to = [0.002, 15.998, 15.998] as const;
    const template = slabGeometry(1, 2);
    template.elements[0]!.from = from;
    template.elements[0]!.to = to;
    template.elements[0]!.faces = { north: face(1, "opaque", undefined, [1, 0, 0, 13 / 16]) };
    const unrotated = compileMappedGeometryVoxel(voxel("minecraft:vault"), template)!.topology.quads[0]!;

    for (const rotation of rotations) {
      const rotated = structuredClone(template);
      rotated.elements[0]!.blockRotation = { x: rotation.x, y: rotation.y };
      const quad = compileMappedGeometryVoxel(voxel("minecraft:vault"), rotated)!.topology.quads[0]!;
      const expectedPositions = rotateQuadBlock(unrotated.positions, rotation.x, rotation.y);

      expect(quad.face).toBe(rotation.face);
      quad.positions.forEach((position, index) => expect(position).toBeCloseTo(expectedPositions[index]!, 10));
      quad.normal.forEach((component, index) => expect(component).toBeCloseTo(rotation.normal[index]!, 10));
      expect(quad.faceOcclusionSlot).toBe(rotation.faceSlot);
      expect(quad.shadeFactor).toBe(rotation.shadeFactor);
      expect(quad.bakedUvs).toEqual(unrotated.bakedUvs);
    }
  });

  it("splits one atlas page into complete geometry plans when it needs more than six texture slots", () => {
    const geometry = slabGeometry(1, 2);
    geometry.elements[0]!.faces = {
      down: face(1), up: face(2), north: face(3), south: face(4), west: face(5), east: face(6),
    };
    geometry.elements.push({
      from: [0, 8, 0], to: [16, 16, 16], shade: true,
      faces: { north: face(7) },
    });

    const plans = compileMappedGeometryVoxelPages(voxel("minecraft:dried_ghast"), geometry)!;

    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.topology.elementCount)).toEqual([1, 1]);
    expect(plans.map((plan) => plan.topology.textureSlotCount)).toEqual([6, 1]);
    expect(plans.map((plan) => plan.topology.quads.length)).toEqual([6, 1]);
    expect(plans.map((plan) => plan.faceTiles.slice(0, plan.topology.textureSlotCount))).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7],
    ]);
    expect(plans.every((plan) => plan.page === 0)).toBe(true);
  });

  it("ignores zero-area faces on valid zero-thickness planes", () => {
    const plane: AtlasBlockGeometry = {
      status: "resolved_geometry",
      modelId: "minecraft:block/glow_lichen_plane",
      elements: [{
        from: [0, 0, 0.1],
        to: [16, 16, 0.1],
        shade: true,
        faces: { north: face(1), south: face(1), west: face(1) },
      }],
    };
    const plan = compileMappedGeometryVoxel(voxel("minecraft:glow_lichen"), plane)!;

    expect(plan.topology.quads.map((quad) => quad.face)).toEqual(["north", "south"]);
    expect(plan.topology.quads.every((quad) => quad.positions.every(Number.isFinite))).toBe(true);
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

  it.each([65, 128, 256])("keeps %i distinct valid shapes in real geometry batches and reports the soft target", (shapeCount) => {
    const manifest = manyShapeManifest(shapeCount);
    const atlas = multipartAtlas();
    const voxels = Array.from({ length: shapeCount }, (_, index) => (
      voxel("minecraft:shape", index, { mode: String(index) })
    ));

    const result = createGeometryBatches(voxels, manifest, atlas);
    const geometries = result.batches.map(createAtlasGeometry);
    const geometryBytes = geometries.reduce((total, geometry) => {
      const attributeBytes = Object.values(geometry.attributes)
        .reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0);
      return total + attributeBytes + (geometry.index?.array.byteLength ?? 0);
    }, 0);
    const vertexCount = geometries.reduce((total, geometry) => total + geometry.getAttribute("position").count, 0);
    const triangleCount = geometries.reduce((total, geometry) => total + (geometry.index?.count ?? 0) / 3, 0);

    expect(result.batches).toHaveLength(shapeCount);
    expect(result.fallbackVoxels).toHaveLength(0);
    expect(result.batches.every((batch) => batch.entries.length === 1)).toBe(true);
    expect(result.batchBudget).toEqual({
      target: MAX_GEOMETRY_BATCHES,
      actual: shapeCount,
      overTarget: shapeCount - MAX_GEOMETRY_BATCHES,
    });
    expect(new Set(result.batches.map((batch) => batch.topology.signature)).size).toBe(shapeCount);
    expect(vertexCount).toBe(shapeCount * 4);
    expect(triangleCount).toBe(shapeCount * 2);
    // One one-quad topology and one instance uses 224 bytes of typed geometry/index data.
    expect(geometryBytes).toBe(shapeCount * 224);
    for (const geometry of geometries) geometry.dispose();
    atlas.dispose();
  });

  it("does not reuse the first coordinate's weighted model through the geometry cache", () => {
    const manifest = manyShapeManifest(2);
    const choices = manifest.blockStates[0]!.variants.flatMap((variant) => variant.choices);
    manifest.blockStates[0]!.variants = [{ key: "", conditions: {}, choices }];
    const atlas = multipartAtlas();
    const voxels = Array.from({ length: 24 }, (_, x) => voxel("minecraft:shape", x));
    const expectedSignatures = voxels.map((source) => planGeometryVoxelPages(source, manifest, atlas)![0]!.topology.signature);

    const result = createGeometryBatches(voxels, manifest, atlas);

    expect(new Set(expectedSignatures).size).toBe(2);
    expect(result.fallbackVoxels).toEqual([]);
    expect(result.batches).toHaveLength(2);
    expect(result.batches.reduce((count, batch) => count + batch.entries.length, 0)).toBe(voxels.length);
    for (const batch of result.batches) {
      for (const entry of batch.entries) {
        expect(entry.topology.signature).toBe(expectedSignatures[entry.voxel.x]);
      }
    }
    atlas.dispose();
  });

  it("keeps unsupported geometry on the established fallback path and reports no batch pressure", () => {
    const atlas = multipartAtlas();
    const unsupported = voxel("minecraft:unlisted_shape");

    const result = createGeometryBatches([unsupported], multipartManifest(), atlas);

    expect(result.batches).toEqual([]);
    expect(result.fallbackVoxels).toEqual([unsupported]);
    expect(result.batchBudget).toEqual({ target: MAX_GEOMETRY_BATCHES, actual: 0, overTarget: 0 });
    atlas.dispose();
  });

  it("uses 11 geometry attributes plus instanceMatrix and accepts bounded unshaded geometry", () => {
    const plan = compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2))!;
    const geometry = createAtlasGeometry(batchGeometryPlans([plan])[0]!);

    expect(Object.keys(geometry.attributes)).toEqual([
      "position", "normal", "uv", "faceSlot", "faceOcclusionSlot", "faceShadeFactor",
      "instanceFaceTilesA", "instanceFaceTilesB", "instanceFaceTintKinds", "instanceFaceOcclusion", "instanceMaterialResponse",
    ]);
    expect(Object.keys(geometry.attributes).length + 4).toBe(15);
    expect(compileMappedGeometryVoxel(voxel("minecraft:oak_slab"), slabGeometry(1, 2, "translucent"))?.alphaMode).toBe("translucent");
    expect(compileMappedGeometryVoxel(voxel("example:oak_slab"), slabGeometry(1, 2, "opaque", 0))).toBeUndefined();
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

function rotateQuadBlock(
  positions: readonly [number, number, number, number, number, number, number, number, number, number, number, number],
  xDegrees: 0 | 90 | 180 | 270,
  yDegrees: 0 | 90 | 180 | 270,
): typeof positions {
  const output: number[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    let [x, y, z] = positions.slice(index, index + 3) as [number, number, number];
    for (let turn = 0; turn < xDegrees / 90; turn += 1) [y, z] = [16 - z, y];
    for (let turn = 0; turn < yDegrees / 90; turn += 1) [x, z] = [z, 16 - x];
    output.push(x, y, z);
  }
  return output as unknown as typeof positions;
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
