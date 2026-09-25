import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import {
  blockEntityFacingYaw,
  createStaticBlockEntityDisplayRenderer,
  planStaticCampfireItemMarkers,
  planStaticSignDisplay,
  standingSignYaw,
  staticItemMarkerAppearance,
} from "../src/resource-special-block-entity";

function signVoxel(
  sourceBlockId: string,
  sourceBlockState: Record<string, string> = {},
): BlueprintVoxel {
  return {
    x: 1,
    y: 2,
    z: 3,
    materialId: "wood",
    buildOrder: 10_000,
    sourceBlockId,
    sourceBlockState,
    sign: {
      front: { lines: ["Synthetic front"], dyeColor: "red", glowing: true },
      back: { lines: ["Synthetic back"], dyeColor: "light_blue", glowing: false },
    },
  };
}

function campfireVoxel(facing: string): BlueprintVoxel {
  return {
    x: 4,
    y: 5,
    z: 6,
    materialId: "stone",
    buildOrder: 10_000,
    sourceBlockId: "minecraft:campfire",
    sourceBlockState: { facing, lit: "true" },
    campfire: {
      slots: [
        { slot: 3, itemId: "minecraft:stick", count: 4 },
        { slot: 0, itemId: "minecraft:bread", count: 1 },
        { slot: 1, itemId: "minecraft:apple", count: 2 },
        { slot: 2, itemId: "minecraft:potato", count: 3 },
      ],
    },
  };
}

describe("static 26.3 sign and campfire block-entity displays", () => {
  it("plans standing, wall, hanging, and wall-hanging sign orientation from block state", () => {
    const standing = planStaticSignDisplay(signVoxel("minecraft:oak_sign", { rotation: "4" }));
    const wall = planStaticSignDisplay(signVoxel("minecraft:oak_wall_sign", { facing: "north" }));
    const hanging = planStaticSignDisplay(signVoxel("minecraft:oak_hanging_sign", { rotation: "8" }));
    const wallHanging = planStaticSignDisplay(signVoxel("minecraft:oak_wall_hanging_sign", { facing: "east" }));

    expect(standing).toMatchObject({ mounting: "standing", yaw: -Math.PI / 2 });
    expect(wall).toMatchObject({ mounting: "wall", yaw: Math.PI, boardCenterZ: -0.42 });
    expect(hanging).toMatchObject({ mounting: "hanging", yaw: -Math.PI });
    expect(wallHanging).toMatchObject({ mounting: "wall-hanging", yaw: Math.PI / 2 });
    expect(standing?.front).toMatchObject({ lines: ["Synthetic front"], dyeColor: "red", glowing: true });
    expect(standing?.back).toMatchObject({ lines: ["Synthetic back"], dyeColor: "light_blue", glowing: false });
  });

  it("uses stable safe defaults for incomplete or invalid sign state", () => {
    expect(standingSignYaw(undefined)).toBe(0);
    expect(standingSignYaw("16")).toBe(0);
    expect(blockEntityFacingYaw("up")).toBe(0);
    expect(planStaticSignDisplay(signVoxel("minecraft:stone"))).toBeNull();
  });

  it("keeps campfire slots distinct and rotates the four-corner plan for every facing", () => {
    const facings = ["north", "east", "south", "west"];
    const plans = facings.map((facing) => planStaticCampfireItemMarkers(campfireVoxel(facing)));

    for (const markers of plans) {
      expect(markers.map((marker) => marker.slot)).toEqual([0, 1, 2, 3]);
      expect(new Set(markers.map((marker) => marker.x.toFixed(6) + ":" + marker.z.toFixed(6))).size).toBe(4);
      expect(markers.every((marker) => Math.hypot(marker.x, marker.z) > 0.17)).toBe(true);
    }
    expect(plans[0]!.map((marker) => [marker.slot, marker.x, marker.z]))
      .not.toEqual(plans[1]!.map((marker) => [marker.slot, marker.x, marker.z]));
    expect(plans[0]!.map((marker) => marker.y)).toEqual([-0.23828125, -0.23828125, -0.23828125, -0.23828125]);
    expect(plans[0]![3]!.stackTokenCount).toBe(3);
  });

  it("derives repeatable fallback item appearances from the exact item ID", () => {
    expect(staticItemMarkerAppearance("minecraft:bread"))
      .toEqual(staticItemMarkerAppearance("minecraft:bread"));
    expect(staticItemMarkerAppearance("minecraft:bread").hash)
      .not.toBe(staticItemMarkerAppearance("minecraft:stick").hash);
    expect(staticItemMarkerAppearance("minecraft:bread").hueDegrees)
      .not.toBe(staticItemMarkerAppearance("minecraft:stick").hueDegrees);
  });

  it("keeps static displays safe in a headless no-Canvas runtime and consumes matching fallback blocks", () => {
    expect(typeof document).toBe("undefined");
    const sign = signVoxel("minecraft:oak_sign", { rotation: "2" });
    const campfire = campfireVoxel("south");
    const root = new THREE.Group();
    const renderer = createStaticBlockEntityDisplayRenderer();
    const replacedFallbacks = renderer.add(root, [sign, campfire], [sign, campfire]);

    expect(replacedFallbacks).toEqual(new Set([sign, campfire]));
    expect(root.children.some((child) => String(child.userData.specialBlockKind).startsWith("approximate_sign_board_"))).toBe(true);
    expect(root.children.some((child) => child.userData.specialBlockKind === "approximate_campfire_logs")).toBe(true);
    expect(root.children.some((child) => child.userData.specialBlockKind === "approximate_campfire_item_markers")).toBe(true);
    expect(root.children.every((child) => Array.isArray(child.userData.blockEntityDataLimitations))).toBe(true);
    renderer.reset();
  });
});
