import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT } from "../src/blueprint";
import {
  layoutWorlds, alignWorldsToEnvironment, naturalDecorationPlacementsForScene,
  naturalDecorationGeometry, naturalDecorationOriginY, naturalDecorationRenderScale,
} from "../src/renderer";
import { naturalDecorationParts, type NaturalDecorationKind } from "../src/natural-decorations";
import { createSteppedTerrainData, settlementSupportHeightForPlacement } from "../src/terrain";
import { roadCellsForVillage } from "../src/village";

const kinds: readonly NaturalDecorationKind[] = ["flower", "grass-tuft", "rock", "reed", "coral",
  "red-shrub", "leaf-litter", "shelf-mushroom", "camp", "shipwreck"];

describe("world-owned environment geometry", () => {
  it.each(kinds)("keeps complete triangles, finite normals and bounds for %s in both LODs", kind => {
    for (const lod of ["full", "silhouette"] as const) {
      const geometry = naturalDecorationGeometry(kind, lod);
      try {
        const positions = geometry.getAttribute("position");
        expect(positions.count).toBe(naturalDecorationParts(kind, lod).length * 36);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        const normals = geometry.getAttribute("normal");
        for (let index = 0; index < normals.count; index += 1)
          expect(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))).toBeCloseTo(1, 5);
        expect(geometry.boundingBox!.isEmpty()).toBe(false);
        expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
      } finally { geometry.dispose(); }
    }
  });

  it("sits land details on visible terrain, while the wreck straddles water", () => {
    for (const kind of kinds.filter(kind => kind !== "shipwreck" && kind !== "shelf-mushroom")) {
      const geometry = naturalDecorationGeometry(kind, "full");
      try {
        for (const scale of [0.6, 1, 1.4]) {
          const y = naturalDecorationOriginY(kind, "ground", 4, geometry.boundingBox!.min.y, scale);
          expect(y + geometry.boundingBox!.min.y * scale).toBeCloseTo(3.5, 6);
        }
      } finally { geometry.dispose(); }
    }
    for (const lod of ["full", "silhouette"] as const) {
      const geometry = naturalDecorationGeometry("shipwreck", lod);
      try {
        const y = naturalDecorationOriginY("shipwreck", "water", 4, geometry.boundingBox!.min.y, 1);
        expect(y + geometry.boundingBox!.min.y).toBeLessThan(3.5);
        expect(y + geometry.boundingBox!.max.y).toBeGreaterThan(3.5);
      } finally { geometry.dispose(); }
    }
  });

  it.each(["classic-island", "natural-valley", "ocean-island"] as const)(
    "uses supported world positions rather than project identity in %s", environmentStyle => {
      const source = [
        { projectId: "small", blueprintId: SMALL_WORKSHOP_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 },
        { projectId: "large", blueprintId: TIMBER_HOUSE_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 1 },
      ] as const;
      const worlds = alignWorldsToEnvironment(layoutWorlds(source), environmentStyle).map(world => ({
        ...world, worldPosition: { ...world.worldPosition, y: Math.max(world.worldPosition.y, settlementSupportHeightForPlacement(world, environmentStyle)) },
      }));
      const roads = roadCellsForVillage(worlds);
      const pads = worlds.map(world => ({ x: world.worldPosition.x, z: world.worldPosition.z,
        width: world.footprint.width, depth: world.footprint.depth, groundLevel: world.worldPosition.y }));
      const terrain = createSteppedTerrainData(worlds, roads, pads, undefined, {
        environmentStyle, worldSeed: "natural-geometry", terrainGenerationVersion: 4,
      });
      const input = { worlds, roads, importedDecorations: [], environmentStyle, terrain, worldSeed: "natural-geometry" };
      const placements = naturalDecorationPlacementsForScene(input);
      expect(placements.length).toBeGreaterThanOrEqual(4);
      expect(placements).toEqual(naturalDecorationPlacementsForScene({ ...input,
        worlds: worlds.map(world => ({ ...world, projectId: `renamed-${world.projectId}` })) }));
      expect(placements.some(entry => entry.kind === "camp" && entry.support === "ground")).toBe(true);
      const wrecks = placements.filter(entry => entry.kind === "shipwreck");
      expect(wrecks).toHaveLength(environmentStyle === "ocean-island" ? 1 : 0);
      for (const entry of wrecks) expect(entry.support).toBe("water");
      for (const entry of placements) {
        expect(Number.isFinite(entry.y)).toBe(true);
        expect(entry.x).toBeGreaterThanOrEqual(terrain.bounds.minX);
        expect(entry.x).toBeLessThanOrEqual(terrain.bounds.maxX);
        expect(entry.z).toBeGreaterThanOrEqual(terrain.bounds.minZ);
        expect(entry.z).toBeLessThanOrEqual(terrain.bounds.maxZ);
        for (const world of worlds)
          expect(Math.abs(entry.x - world.worldPosition.x) <= (world.footprint.width + 5) / 2
            && Math.abs(entry.z - world.worldPosition.z) <= (world.footprint.depth + 5) / 2).toBe(false);
      }

      // Match the normal phone framing: landmarks must be visible in distant LOD.
      const bounds = new THREE.Box3(new THREE.Vector3(terrain.framingBounds.minX, -2.5, terrain.framingBounds.minZ),
        new THREE.Vector3(terrain.framingBounds.maxX, 4, terrain.framingBounds.maxZ));
      for (const world of worlds) bounds.expandByPoint(new THREE.Vector3(world.worldPosition.x,
        world.worldPosition.y + world.blueprint.bounds.maxY + 0.5, world.worldPosition.z));
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(34, 390 / 844, 0.1, 2_000);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = Math.max(6, size.length() / 2) / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.04;
      const target = new THREE.Vector3(center.x, Math.max(1.5, center.y * 0.68), center.z);
      const pitch = THREE.MathUtils.degToRad(38);
      camera.position.set(target.x + Math.cos(Math.PI / 4) * Math.cos(pitch) * distance,
        target.y + Math.sin(pitch) * distance, target.z + Math.sin(Math.PI / 4) * Math.cos(pitch) * distance);
      camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      for (const entry of placements.filter(entry => entry.kind === "camp" || entry.kind === "shipwreck")) {
        const geometry = naturalDecorationGeometry(entry.kind, "silhouette");
        try {
          const scale = naturalDecorationRenderScale(entry.kind) * entry.scale;
          const y = naturalDecorationOriginY(entry.kind, entry.support, entry.y!, geometry.boundingBox!.min.y, scale);
          const top = new THREE.Vector3(entry.x, y + geometry.boundingBox!.max.y * scale, entry.z).project(camera);
          const bottom = new THREE.Vector3(entry.x, y + geometry.boundingBox!.min.y * scale, entry.z).project(camera);
          expect(Math.abs(top.x)).toBeLessThan(1.05);
          expect(Math.abs(top.y)).toBeLessThan(1.05);
          expect(Math.abs(top.y - bottom.y) * 844 / 2).toBeGreaterThan(3.5);
        } finally { geometry.dispose(); }
      }
    },
  );
});
