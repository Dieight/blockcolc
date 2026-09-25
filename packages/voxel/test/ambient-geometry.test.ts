import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT } from "../src/blueprint";
import { layoutWorlds, alignWorldsToEnvironment, ambientDecorationPlacementsForScene, ambientDecorationRenderScale } from "../src/renderer";
import { createSteppedTerrainData, settlementSupportHeightForPlacement } from "../src/terrain";
import { roadCellsForVillage } from "../src/village";
import {
  ambientDecorationCanUseSurface,
  ambientDecorationGeometryForTest,
  ambientDecorationOriginY,
  ambientDecorationGroundForSurface,
} from "../src/renderer";

describe("original ambient decoration geometry", () => {
  it("allows shipwrecks only on a real water surface while land flora stays on land", () => {
    expect(ambientDecorationCanUseSurface("shipwreck", true)).toBe(true);
    expect(ambientDecorationCanUseSurface("shipwreck", false)).toBe(false);
    expect(ambientDecorationCanUseSurface("flower", false)).toBe(true);
    expect(ambientDecorationCanUseSurface("flower", true)).toBe(false);
    expect(ambientDecorationGroundForSurface("shipwreck", 9, 11, undefined)).toBeNull();
    expect(ambientDecorationGroundForSurface("shipwreck", 9, 11, 4)).toBe(4);
    expect(ambientDecorationGroundForSurface("flower", 9, 11, undefined)).toBe(11);
    expect(ambientDecorationGroundForSurface("flower", 9, 3, undefined)).toBe(3);
    expect(ambientDecorationGroundForSurface("flower", 9, 11, 4)).toBeNull();
  });

  it("anchors transformed land geometry to visible terrain rather than floating above its support datum", () => {
    for (const kind of ["flower", "grass-tuft", "rock", "reed", "coral"] as const) {
      const geometry = ambientDecorationGeometryForTest(kind);
      try {
        for (const scale of [0.6, 1, 1.4]) {
          const origin = ambientDecorationOriginY(kind, 4, geometry.boundingBox!.min.y, scale);
          const positions = geometry.getAttribute("position");
          let bottom = Infinity;
          for (let i = 0; i < positions.count; i += 1) bottom = Math.min(bottom, origin + positions.getY(i) * scale);
          expect(bottom).toBeCloseTo(3.5, 6);
        }
      } finally { geometry.dispose(); }
    }
    const wreck = ambientDecorationGeometryForTest("shipwreck");
    try {
      const origin = ambientDecorationOriginY("shipwreck", 4, wreck.boundingBox!.min.y, 1);
      expect(origin + wreck.boundingBox!.min.y).toBeLessThan(3.5);
      expect(origin + wreck.boundingBox!.max.y).toBeGreaterThan(3.5);
    } finally { wreck.dispose(); }
  });

  it("merges readable flower and grass silhouettes instead of single cuboids", () => {
    const flower = ambientDecorationGeometryForTest("flower");
    const grass = ambientDecorationGeometryForTest("grass-tuft");
    try {
      expect(flower.getAttribute("position").count).toBeGreaterThan(24);
      expect(grass.getAttribute("position").count).toBeGreaterThan(24);
      expect(flower.getIndex()?.count).toBeGreaterThan(36);
      expect(grass.getIndex()?.count).toBeGreaterThan(36);
      expect(flower.boundingSphere?.radius).toBeGreaterThan(0.4);
      expect(grass.boundingSphere?.radius).toBeGreaterThan(0.25);
    } finally {
      flower.dispose();
      grass.dispose();
    }
  });

  it("merges shipwreck hull, deck, mast, and broken spar into one instanced geometry", () => {
    const wreck = ambientDecorationGeometryForTest("shipwreck");
    try {
      const position = wreck.getAttribute("position");
      const boxOnlyVertexCount = 24;
      expect(position.count).toBeGreaterThan(boxOnlyVertexCount * 4);
      wreck.computeBoundingBox();
      expect(wreck.boundingBox!.max.x - wreck.boundingBox!.min.x).toBeGreaterThan(2);
      expect(wreck.boundingBox!.max.y - wreck.boundingBox!.min.y).toBeGreaterThan(1.5);
      expect(wreck.boundingBox!.max.z - wreck.boundingBox!.min.z).toBeGreaterThan(0.8);
    } finally {
      wreck.dispose();
    }
  });

  it("places readable decorations on terrain and in the default camera view in all environments", () => {
    const sourceWorlds = [
      { projectId: "ambient-small", blueprintId: SMALL_WORKSHOP_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 },
      { projectId: "ambient-large", blueprintId: TIMBER_HOUSE_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 1 },
    ] as const;
    const original = layoutWorlds(sourceWorlds);
    const visiblePixelHeights: number[] = [];
    const environmentKinds = new Map<string, Set<string>>();

    for (const environmentStyle of ["classic-island", "natural-valley", "ocean-island"] as const) {
      const positioned = alignWorldsToEnvironment(original, environmentStyle).map((world) => {
        const support = settlementSupportHeightForPlacement(world, environmentStyle);
        return support > world.worldPosition.y
          ? { ...world, worldPosition: { ...world.worldPosition, y: support } }
          : world;
      });
      const roads = roadCellsForVillage(positioned);
      const pads = positioned.map((world) => ({
        x: world.worldPosition.x,
        z: world.worldPosition.z,
        width: world.footprint.width,
        depth: world.footprint.depth,
        groundLevel: world.worldPosition.y,
      }));
      const terrain = createSteppedTerrainData(positioned, roads, pads, undefined, {
        environmentStyle,
        worldSeed: `ambient-r03-${environmentStyle}`,
        terrainGenerationVersion: 4,
      });
      const placements = ambientDecorationPlacementsForScene({
        worlds: positioned,
        roads,
        importedDecorations: [],
        environmentStyle,
        terrain,
        worldSeed: `ambient-r03-${environmentStyle}`,
      });
      environmentKinds.set(environmentStyle, new Set(placements.map(({ kind }) => kind)));
      expect(placements.length, `${environmentStyle} accepted terrain placements`).toBeGreaterThanOrEqual(4);
      for (const world of positioned) {
        expect(
          placements.filter((placement) => placement.projectId === world.projectId).length,
          `${environmentStyle} placements around ${world.projectId}`,
        ).toBeGreaterThanOrEqual(2);
      }
      for (const placement of placements) {
        expect(placement.surface).toBe(placement.kind === "shipwreck" ? "water" : "land");
        expect(placement.x).toBeGreaterThanOrEqual(terrain.bounds.minX);
        expect(placement.x).toBeLessThanOrEqual(terrain.bounds.maxX);
        expect(placement.z).toBeGreaterThanOrEqual(terrain.bounds.minZ);
        expect(placement.z).toBeLessThanOrEqual(terrain.bounds.maxZ);
      }

      // Reproduce rebuild/updateSceneBounds + frameScene's normal settlement
      // fit so projected prop size and clipping are tested at phone portrait size.
      const bounds = new THREE.Box3(
        new THREE.Vector3(terrain.framingBounds.minX, -2.5, terrain.framingBounds.minZ),
        new THREE.Vector3(terrain.framingBounds.maxX, 4, terrain.framingBounds.maxZ),
      );
      for (const world of positioned) bounds.expandByPoint(new THREE.Vector3(
        world.worldPosition.x,
        world.worldPosition.y + world.blueprint.bounds.maxY + 0.5,
        world.worldPosition.z,
      ));
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(6, size.length() / 2);
      const camera = new THREE.PerspectiveCamera(34, 390 / 844, 0.1, 2_000);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.04;
      const target = new THREE.Vector3(center.x, Math.max(1.5, center.y * 0.68), center.z);
      const pitch = THREE.MathUtils.degToRad(38);
      const azimuth = Math.PI / 4;
      const horizontal = Math.cos(pitch) * distance;
      camera.position.set(
        target.x + Math.cos(azimuth) * horizontal,
        target.y + Math.sin(pitch) * distance,
        target.z + Math.sin(azimuth) * horizontal,
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const towardCamera = new THREE.Vector2(camera.position.x - target.x, camera.position.z - target.z).normalize();
      const foregroundByProject = new Set<string>();

      for (const placement of placements) {
        const world = positioned.find((entry) => entry.projectId === placement.projectId)!;
        if ((placement.x - world.worldPosition.x) * towardCamera.x
          + (placement.z - world.worldPosition.z) * towardCamera.y > 0) foregroundByProject.add(placement.projectId);
        const geometry = ambientDecorationGeometryForTest(placement.kind);
        try {
          const { height } = ambientDecorationRenderScale(placement.kind, placement.scale, placement.variant);
          const origin = ambientDecorationOriginY(placement.kind, placement.y, geometry.boundingBox!.min.y, height);
          const bottom = new THREE.Vector3(placement.x, origin + geometry.boundingBox!.min.y * height, placement.z).project(camera);
          const top = new THREE.Vector3(placement.x, origin + geometry.boundingBox!.max.y * height, placement.z).project(camera);
          expect(Math.abs(bottom.x)).toBeLessThan(1.05);
          expect(Math.abs(bottom.y)).toBeLessThan(1.05);
          expect(Math.abs(top.x)).toBeLessThan(1.05);
          expect(Math.abs(top.y)).toBeLessThan(1.05);
          const projectedHeight = Math.abs(top.y - bottom.y) * 844 / 2;
          visiblePixelHeights.push(projectedHeight);
          // Every rendered silhouette should occupy more than a few CSS pixels
          // at fitted portrait view; otherwise it exists only in metadata.
          expect(projectedHeight, `${environmentStyle} ${placement.kind} projected height`).toBeGreaterThanOrEqual(3.5);
        } finally {
          geometry.dispose();
        }
      }
      expect(foregroundByProject.size).toBe(2);
    }

    expect(environmentKinds.get("ocean-island")?.has("coral") || environmentKinds.get("ocean-island")?.has("reed")).toBe(true);
    expect(visiblePixelHeights.length).toBeGreaterThan(0);
  });
});
