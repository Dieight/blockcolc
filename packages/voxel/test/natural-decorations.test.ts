import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cameraZoomBounds } from "../src/camera-zoom";
import {
  ambientEnvironmentDecorations,
  naturalDecorationBatchDiagnostics,
  naturalDecorationParts,
  naturalDecorationLodForCamera,
  naturalDecorationVariantVisible,
  naturalTreeMushroomCandidates,
  naturalTreeMushroomContactPlacement,
  NATURAL_SHELF_MUSHROOM_RENDER_SCALE,
  visibleNaturalTreeCount,
  type NaturalDecorationCandidate,
  type NaturalDecorationKind,
} from "../src/natural-decorations";

describe("world-owned natural decorations", () => {
  it.each(["settlement", "preview", "focused"] as const)("switches reachable geometry inside %s camera bounds", (mode) => {
    const bounds = cameraZoomBounds(100, mode);
    const silhouetteBoundary = bounds.maximum * 0.94;
    const fullBoundary = bounds.maximum * 0.88;
    expect(silhouetteBoundary).toBeLessThanOrEqual(bounds.maximum);
    expect(naturalDecorationLodForCamera(bounds.maximum, bounds.maximum, "full")).toBe("silhouette");
    expect(naturalDecorationLodForCamera(silhouetteBoundary - 0.01, bounds.maximum, "full")).toBe("full");
    expect(naturalDecorationLodForCamera(silhouetteBoundary, bounds.maximum, "silhouette")).toBe("silhouette");
    expect(naturalDecorationLodForCamera(fullBoundary, bounds.maximum, "silhouette")).toBe("full");
    expect(naturalDecorationLodForCamera(fullBoundary + 0.01, bounds.maximum, "silhouette")).toBe("silhouette");
  });

  const candidates: NaturalDecorationCandidate[] = [];
  for (let x = -30; x <= 30; x += 5) {
    for (let z = -30; z <= 30; z += 5) {
      candidates.push({ x, z, support: "ground" });
      candidates.push({ x: x + 1, z: z + 1, support: "water" });
    }
  }

  it("returns stable terrain-anchored identity independent of candidate enumeration order", () => {
    const forward = ambientEnvironmentDecorations({ environmentStyle: "ocean-island", worldSeed: "acceptance-world", candidates });
    const reverse = ambientEnvironmentDecorations({ environmentStyle: "ocean-island", worldSeed: "acceptance-world", candidates: [...candidates].reverse() });
    expect(reverse).toEqual(forward);
    expect(forward.map((entry) => entry.id).every((id) => !id.includes("project"))).toBe(true);
    expect(new Set(forward.map((entry) => entry.id)).size).toBe(forward.length);
  });

  it("anchors camp to land and limits wrecks to ocean water candidates", () => {
    const placements = ambientEnvironmentDecorations({ environmentStyle: "ocean-island", worldSeed: "shore", candidates });
    const camp = placements.find((entry) => entry.kind === "camp");
    const shipwrecks = placements.filter((entry) => entry.kind === "shipwreck");
    expect(camp).toBeDefined();
    expect(candidates.some((entry) => entry.support === "ground" && entry.x === camp!.x && entry.z === camp!.z)).toBe(true);
    expect(shipwrecks).toHaveLength(1);
    expect(shipwrecks.every((wreck) => candidates.some((entry) => entry.support === "water" && entry.x === wreck.x && entry.z === wreck.z))).toBe(true);

    const landOnly = ambientEnvironmentDecorations({
      environmentStyle: "natural-valley",
      worldSeed: "valley",
      candidates: candidates.filter((entry) => entry.support === "ground"),
    });
    expect(landOnly.some((entry) => entry.kind === "shipwreck")).toBe(false);
    expect(landOnly.some((entry) => entry.kind === "camp")).toBe(true);
  });

  it("keeps a bounded stable plan and changes it only with the world seed or candidate field", () => {
    const first = ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "a", candidates });
    const same = ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "a", candidates });
    const other = ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "b", candidates });
    expect(first).toEqual(same);
    expect(first.length).toBeLessThanOrEqual(30);
    expect(first.map((entry) => entry.id)).not.toEqual(other.map((entry) => entry.id));
    expect(first.every((entry) => candidates.some((candidate) => candidate.x === entry.x && candidate.z === entry.z))).toBe(true);
  });

  it.each(["flower", "grass-tuft", "rock", "reed", "coral", "red-shrub", "leaf-litter", "shelf-mushroom", "camp", "shipwreck"] as const)(
    "provides a compact distant silhouette for %s",
    (kind: NaturalDecorationKind) => {
      const full = naturalDecorationParts(kind, "full");
      const silhouette = naturalDecorationParts(kind, "silhouette");
      expect(full.length).toBeGreaterThan(0);
      expect(silhouette.length).toBeGreaterThan(0);
      expect(silhouette.length).toBeLessThanOrEqual(full.length);
      expect(silhouette.every((part) => part.size.every((dimension) => dimension > 0))).toBe(true);
    },
  );

  it.each(["full", "silhouette"] as const)("renders only the %s flower variant for one shared placement plan", (lod) => {
    const visible = (["full", "silhouette"] as const).filter(variant => naturalDecorationVariantVisible(lod, variant));
    expect(visible).toEqual([lod]);
  });

  it("reports visible decoration batches separately from allocated alternate LODs", () => {
    expect(naturalDecorationBatchDiagnostics([
      { kind: "flower", visible: true },
      { kind: "flower", visible: true },
      { kind: "flower", visible: false },
      { kind: "rock", visible: true, castsShadow: true },
    ])).toEqual({ kindCount: 2, drawCalls: 3, allocatedBatchCount: 4, shadowCasters: 1 });
  });

  it("retains the campsite tent peak and ship hull plus mast in silhouette LOD", () => {
    const camp = naturalDecorationParts("camp", "silhouette");
    const wreck = naturalDecorationParts("shipwreck", "silhouette");
    expect(camp.some((part) => part.size[1] >= 0.8 && part.size[0] > 1)).toBe(true);
    expect(wreck.some((part) => part.size[0] > 1.4 && part.size[1] < 0.3)).toBe(true);
    expect(wreck.some((part) => part.size[1] > 1.4 && part.size[0] < 0.2)).toBe(true);
  });

  it("places shelf mushrooms only on stable tree supports and carries the host height", () => {
    const treeCandidates: NaturalDecorationCandidate[] = [
      { x: 2, y: 8, z: 5, support: "tree" },
      { x: -4, y: 11, z: 3, support: "tree" },
    ];
    const first = ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "poplar", candidates: treeCandidates });
    const repeat = ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "poplar", candidates: [...treeCandidates].reverse() });
    expect(repeat).toEqual(first);
    expect(first.every((entry) => entry.kind === "shelf-mushroom" && entry.support === "tree"
      && treeCandidates.some(candidate => candidate.y === entry.y))).toBe(true);
  });

  it("uses the same deterministic tree prefix as quality culling and places mushrooms beside scaled trunks", () => {
    const trees = [
      { x: 3, y: 5, z: 9, scale: 1.25 },
      { x: -12, y: 2, z: 6, scale: 0.8 },
      { x: 18, y: 4, z: -7, scale: 1.1 },
      { x: 30, y: 1, z: 2, scale: 0.9 },
      { x: 42, y: 3, z: 4, scale: 1.3 },
    ];
    expect(visibleNaturalTreeCount(0, "low")).toBe(0);
    expect(visibleNaturalTreeCount(5, "low")).toBe(2);
    expect(visibleNaturalTreeCount(5, "balanced")).toBe(3);
    expect(visibleNaturalTreeCount(5, "high")).toBe(5);
    const candidates = naturalTreeMushroomCandidates(trees, visibleNaturalTreeCount(trees.length, "low"));
    expect(candidates).toHaveLength(8);
    expect(candidates.every(candidate => candidate.support === "tree" && candidate.supportTreeIndex! < 2)).toBe(true);
    expect(candidates.some(candidate => candidate.x === 3 + 0.5 * 1.25 && candidate.y === 5 + 1.65 * 1.25)).toBe(true);
    const selected = ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "tree-seed", candidates });
    expect(selected.filter(entry => entry.kind === "shelf-mushroom")).toHaveLength(1);
    const mushroom = selected.find(entry => entry.kind === "shelf-mushroom")!;
    expect(mushroom.supportTreeIndex).toBeLessThan(2);
    const anchor = mushroom.treeSupport!;
    const radialOffset = (mushroom.x - anchor.x) * anchor.normalX + (mushroom.z - anchor.z) * anchor.normalZ;
    const renderedCapHalfWidth = 0.58 * NATURAL_SHELF_MUSHROOM_RENDER_SCALE * mushroom.scale / 2;
    expect(radialOffset - renderedCapHalfWidth).toBeCloseTo(0.72 * anchor.scale / 2, 10);
    expect(ambientEnvironmentDecorations({ environmentStyle: "natural-valley", worldSeed: "tree-seed", candidates: [...candidates].reverse() }))
      .toEqual(selected);
  });

  it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5])("keeps full and silhouette caps in trunk contact across supported scales (direction %s)", (angle) => {
    for (const treeScale of [0.82, 1, 1.22]) {
      const normalX = Math.cos(angle);
      const normalZ = Math.sin(angle);
      const support = { x: 3, y: 5, z: -2, scale: treeScale, normalX, normalZ };
      for (const entryScale of [0.88, 1.1]) {
        const placement = naturalTreeMushroomContactPlacement(support, entryScale);
        const radialOffset = (placement.x - support.x) * normalX + (placement.z - support.z) * normalZ;
        const trunkHalfWidth = 0.72 * treeScale / 2;
        const capHalfWidth = 0.58 * NATURAL_SHELF_MUSHROOM_RENDER_SCALE * entryScale / 2;
        expect(radialOffset - capHalfWidth).toBeCloseTo(trunkHalfWidth, 10);
        expect(placement.rotationY).toBeCloseTo(Math.atan2(-normalZ, normalX), 10);
        for (const lod of ["full", "silhouette"] as const) {
          const cap = naturalDecorationParts("shelf-mushroom", lod).find(part => part.palette === "accent")!;
          expect(cap.size[0]).toBe(0.58);
          const local = new THREE.Matrix4().makeRotationZ(cap.rotationZ ?? 0)
            .multiply(new THREE.Matrix4().makeRotationY(cap.rotationY ?? 0));
          local.setPosition(...cap.position);
          const world = new THREE.Matrix4().compose(
            new THREE.Vector3(placement.x, support.y + 1.65 * treeScale, placement.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY),
            new THREE.Vector3(
              NATURAL_SHELF_MUSHROOM_RENDER_SCALE * entryScale,
              NATURAL_SHELF_MUSHROOM_RENDER_SCALE * entryScale,
              NATURAL_SHELF_MUSHROOM_RENDER_SCALE * entryScale,
            ),
          );
          const capGeometry = new THREE.BoxGeometry(...cap.size);
          const positions = capGeometry.getAttribute("position");
          const transformed = Array.from({ length: positions.count }, (_, index) =>
            new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index))
              .applyMatrix4(local).applyMatrix4(world));
          const minimumRadial = Math.min(...transformed.map(point =>
            (point.x - support.x) * normalX + (point.z - support.z) * normalZ));
          expect(minimumRadial).toBeCloseTo(trunkHalfWidth, 5);
          expect(Math.max(...transformed.map(point => point.y))).toBeGreaterThan(support.y);
          expect(Math.min(...transformed.map(point => point.y))).toBeLessThan(support.y + 2.4 * treeScale);
          capGeometry.dispose();
        }
      }
    }
  });
});
