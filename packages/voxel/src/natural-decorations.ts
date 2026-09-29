import type { EnvironmentStyle } from "./environment";

export type NaturalDecorationKind = "flower" | "grass-tuft" | "rock" | "reed" | "coral" | "red-shrub" | "leaf-litter" | "shelf-mushroom" | "camp" | "shipwreck";
export type NaturalDecorationLod = "full" | "silhouette";
export type NaturalDecorationSupport = "ground" | "water" | "tree";

export interface NaturalDecorationCandidate {
  x: number;
  z: number;
  support: NaturalDecorationSupport;
  y?: number;
  supportTreeIndex?: number;
  treeSupport?: NaturalTreeMushroomSupport;
}

export interface NaturalTreeMushroomSupport {
  x: number;
  y: number;
  z: number;
  scale: number;
  normalX: number;
  normalZ: number;
}

export interface NaturalDecorationPlacement {
  id: string;
  kind: NaturalDecorationKind;
  support: NaturalDecorationSupport;
  x: number;
  z: number;
  y?: number;
  rotationY: number;
  variant: number;
  scale: number;
  supportTreeIndex?: number;
  treeSupport?: NaturalTreeMushroomSupport;
}

export interface NaturalDecorationPart {
  size: readonly [number, number, number];
  position: readonly [number, number, number];
  rotationY?: number;
  rotationZ?: number;
  palette: "base" | "secondary" | "accent";
}

/** A small hysteresis band keeps camera-easing near the boundary from swapping geometry every frame. */
export function naturalDecorationLodForCamera(
  cameraDistance: number,
  maximumCameraDistance: number,
  current: NaturalDecorationLod = "full",
): NaturalDecorationLod {
  const distance = Math.max(0, Number.isFinite(cameraDistance) ? cameraDistance : 0);
  const maximum = Math.max(0.001, Number.isFinite(maximumCameraDistance) ? maximumCameraDistance : 0.001);
  // Both thresholds are derived from the active camera's actual legal upper
  // bound. The old fitted-distance ratios (1.5/1.35) were unreachable in the
  // settlement camera's 1.14x range, so the distant silhouette never appeared.
  if (current === "full") return distance >= maximum * 0.94 ? "silhouette" : "full";
  return distance <= maximum * 0.88 ? "full" : "silhouette";
}

export function naturalDecorationVariantVisible(activeLod: NaturalDecorationLod, variant: NaturalDecorationLod): boolean {
  return activeLod === variant;
}

export function naturalDecorationBatchDiagnostics(batches: readonly { kind: string; visible: boolean; castsShadow?: boolean }[]): {
  kindCount: number;
  drawCalls: number;
  allocatedBatchCount: number;
  shadowCasters: number;
} {
  const visible = batches.filter(batch => batch.visible);
  return {
    kindCount: new Set(visible.map(batch => batch.kind)).size,
    drawCalls: visible.length,
    allocatedBatchCount: batches.length,
    shadowCasters: visible.filter(batch => batch.castsShadow === true).length,
  };
}

export function visibleNaturalTreeCount(total: number, qualityTier: "low" | "balanced" | "high"): number {
  if (total <= 0) return 0;
  const density = qualityTier === "low" ? 0.36 : qualityTier === "balanced" ? 0.68 : 1;
  return Math.max(1, Math.round(total * density));
}

/** Side-mounted candidate points for the actual terrain tree prefix used by the renderer. */
export function naturalTreeMushroomCandidates(
  trees: readonly { x: number; y: number; z: number; scale: number }[],
  visibleCount: number,
): NaturalDecorationCandidate[] {
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  return trees.slice(0, Math.max(0, visibleCount)).flatMap((tree, supportTreeIndex) => directions.map(([dx, dz]) => ({
    x: tree.x + dx * 0.5 * tree.scale,
    z: tree.z + dz * 0.5 * tree.scale,
    y: tree.y + 1.65 * tree.scale,
    support: "tree" as const,
    supportTreeIndex,
    treeSupport: { x: tree.x, y: tree.y, z: tree.z, scale: tree.scale, normalX: dx, normalZ: dz },
  })));
}

export const NATURAL_SHELF_MUSHROOM_RENDER_SCALE = 2.2;

export function naturalTreeMushroomContactPlacement(
  support: NaturalTreeMushroomSupport,
  entryScale: number,
): { x: number; z: number; rotationY: number } {
  const trunkHalfWidth = 0.72 * support.scale / 2;
  const capHalfWidth = 0.58 / 2 * NATURAL_SHELF_MUSHROOM_RENDER_SCALE * entryScale;
  const offset = trunkHalfWidth + capHalfWidth;
  return {
    x: support.x + support.normalX * offset,
    z: support.z + support.normalZ * offset,
    rotationY: Math.atan2(-support.normalZ, support.normalX),
  };
}

/**
 * Produces world-owned decoration placements from sampled terrain surfaces.
 * The plan is stable for a world seed and candidate field and never depends on
 * project, reward, or construction identity.
 */
export function ambientEnvironmentDecorations(input: {
  environmentStyle: EnvironmentStyle;
  worldSeed: string;
  candidates: readonly NaturalDecorationCandidate[];
}): readonly NaturalDecorationPlacement[] {
  const candidates = canonicalCandidates(input.candidates);
  const ground = candidates.filter((candidate) => candidate.support === "ground");
  const water = input.environmentStyle === "ocean-island"
    ? candidates.filter((candidate) => candidate.support === "water")
    : [];
  const trees = candidates.filter((candidate) => candidate.support === "tree");
  const prefix = `natural:${input.environmentStyle}:${input.worldSeed || "world-default"}`;
  const result: NaturalDecorationPlacement[] = [];
  const occupied: Array<{ x: number; z: number; radius: number }> = [];

  // One compact campsite gives the land a deliberate focal point. The point is
  // chosen from the terrain field, not from a building perimeter.
  const camp = chooseCandidate(ground, prefix, "camp");
  if (camp) {
    result.push(placement(prefix, "camp", camp, 0.88 + unitHash(`${prefix}:camp-scale:${camp.x}:${camp.z}`) * 0.18));
    occupied.push({ x: camp.x, z: camp.z, radius: 5.2 });
  }

  // Keep the hull and mast in one deliberately selected shallow-water spot.
  // Its renderer geometry straddles the supplied water datum by design.
  const shipwreck = chooseCandidate(water, prefix, "shipwreck");
  if (shipwreck) {
    result.push(placement(prefix, "shipwreck", shipwreck, 0.96 + unitHash(`${prefix}:shipwreck-scale:${shipwreck.x}:${shipwreck.z}`) * 0.14));
    occupied.push({ x: shipwreck.x, z: shipwreck.z, radius: 6.5 });
  }

  const mushroom = chooseCandidate(trees, prefix, "shelf-mushroom");
  if (mushroom) {
    result.push(placement(prefix, "shelf-mushroom", mushroom, 0.88 + unitHash(`${prefix}:mushroom:${mushroom.x}:${mushroom.z}`) * 0.22));
  }

  const detailCandidates = [...ground, ...water]
    .filter((candidate) => !occupied.some((point) => distanceSquared(point, candidate) < point.radius * point.radius))
    .map((candidate) => ({ candidate, rank: hash32(`${prefix}:detail:${candidate.x}:${candidate.z}:${candidate.support}`) }))
    .sort((left, right) => left.rank - right.rank || compareCandidate(left.candidate, right.candidate));
  const maxNatural = input.environmentStyle === "ocean-island" ? 28 : 30;
  for (const { candidate, rank } of detailCandidates) {
    if (result.length >= maxNatural) break;
    if (occupied.some((point) => distanceSquared(point, candidate) < 3.5 * 3.5)) continue;
    const kind = kindForDetail(input.environmentStyle, candidate.support, rank);
    if (!kind) continue;
    const scale = kind === "flower" || kind === "grass-tuft"
      ? 0.9 + unitHash(`${prefix}:scale:${candidate.x}:${candidate.z}`) * 0.45
      : 0.82 + unitHash(`${prefix}:scale:${candidate.x}:${candidate.z}`) * 0.3;
    result.push(placement(prefix, kind, candidate, scale));
    occupied.push({ x: candidate.x, z: candidate.z, radius: kind === "rock" || kind === "coral" || kind === "reed" ? 2.6 : 1.8 });
  }
  return Object.freeze(result.map((entry) => Object.freeze(entry)));
}

/**
 * Renderer-neutral merged-box descriptions for full and distant silhouettes.
 * Silhouettes keep semantic landmarks (tent peak, ship hull and mast) while
 * removing small trim that aliases at distance.
 */
export function naturalDecorationParts(kind: NaturalDecorationKind, lod: NaturalDecorationLod): readonly NaturalDecorationPart[] {
  const part = (
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    palette: NaturalDecorationPart["palette"] = "base",
    rotationY = 0,
    rotationZ = 0,
  ): NaturalDecorationPart => ({ size, position, palette, rotationY, rotationZ });

  let parts: NaturalDecorationPart[];
  if (kind === "camp") {
    parts = lod === "silhouette"
      ? [
          part([1.4, 0.82, 1.15], [0, 0.44, 0], "base", 0, 0.62),
          part([0.11, 1.04, 0.11], [0, 0.5, 0], "secondary"),
          part([0.34, 0.38, 0.34], [1.18, 0.18, 0], "accent"),
        ]
      : [
          part([1.3, 0.08, 1.08], [0, 0.05, 0], "secondary"),
          part([1.46, 0.07, 1.17], [0, 0.41, 0], "base", 0, 0.61),
          part([1.46, 0.07, 1.17], [0, 0.41, 0], "base", 0, -0.61),
          part([0.1, 1.0, 0.1], [0, 0.5, 0], "secondary"),
          part([0.62, 0.1, 0.1], [1.18, 0.1, -0.04], "secondary", 0.25, 0.12),
          part([0.3, 0.22, 0.3], [1.14, 0.11, 0], "accent"),
          part([0.14, 0.35, 0.14], [1.14, 0.27, 0], "accent"),
          part([0.38, 0.08, 0.11], [0.92, 0.08, 0], "secondary", 0.62),
          part([0.38, 0.08, 0.11], [1.32, 0.08, 0], "secondary", -0.62),
          part([0.78, 0.16, 0.64], [-0.62, 0.12, -0.68], "secondary", 0.12),
          part([0.38, 0.22, 0.36], [-0.62, 0.3, -0.68], "accent", 0.12, 0.08),
        ];
  } else if (kind === "shipwreck") {
    parts = lod === "silhouette"
      ? [
          part([1.8, 0.22, 0.58], [0, 0.18, 0], "base"),
          part([1.42, 0.2, 0.76], [0, 0.37, 0], "base"),
          part([0.13, 1.65, 0.13], [-0.2, 1.18, 0], "secondary", 0, -0.04),
          part([1.12, 0.1, 0.1], [0.16, 1.7, 0], "secondary", 0.16, 0.1),
        ]
      : [
          part([1.58, 0.2, 0.48], [0, 0.15, 0], "base"),
          part([1.92, 0.22, 0.7], [0, 0.34, 0], "base"),
          part([1.58, 0.12, 0.82], [0, 0.5, 0], "secondary"),
          part([0.48, 0.28, 0.78], [-0.76, 0.52, 0], "base", 0, 0.12),
          part([0.42, 0.3, 0.76], [0.78, 0.53, 0], "base", 0, -0.14),
          part([1.44, 0.11, 0.1], [0, 0.63, -0.37], "secondary"),
          part([1.28, 0.11, 0.1], [0.06, 0.63, 0.37], "secondary", 0, 0.05),
          part([0.13, 1.62, 0.13], [-0.2, 1.23, 0], "secondary", 0, -0.04),
          part([1.1, 0.1, 0.1], [0.15, 1.72, 0], "secondary", 0.14, 0.1),
          part([0.67, 0.09, 0.09], [0.63, 1.23, 0.04], "accent", -0.22, -0.38),
        ];
  } else if (kind === "flower") {
    parts = [
      part([0.08, 0.64, 0.08], [0, 0.32, 0], "secondary"),
      part([0.2, 0.1, 0.2], [0, 0.66, 0], "accent"),
      ...Array.from({ length: lod === "silhouette" ? 4 : 5 }, (_, index) => {
        const angle = index * Math.PI * 2 / 5;
        return part([0.17, 0.07, 0.28], [Math.cos(angle) * 0.12, 0.68, Math.sin(angle) * 0.12], "accent", angle);
      }),
    ];
  } else if (kind === "grass-tuft") {
    const blades = lod === "silhouette" ? 3 : 5;
    parts = Array.from({ length: blades }, (_, index) => {
      const angle = -0.42 + index * (0.84 / Math.max(1, blades - 1));
      return part([0.085, 0.58, 0.085], [Math.sin(angle) * 0.12, 0.29, Math.cos(angle) * 0.06], "base", index * Math.PI * 2 / blades, angle);
    });
  } else if (kind === "rock") {
    parts = lod === "silhouette"
      ? [part([0.78, 0.52, 0.68], [0, 0.26, 0], "base", 0, -0.06)]
      : [part([0.78, 0.43, 0.68], [0, 0.22, 0], "base", 0, -0.06), part([0.45, 0.32, 0.42], [0.12, 0.54, -0.04], "secondary", 0.25, 0.12)];
  } else if (kind === "red-shrub") {
    parts = lod === "silhouette"
      ? [part([0.56, 0.7, 0.52], [0, 0.36, 0], "accent"), part([0.12, 0.84, 0.12], [0, 0.42, 0], "secondary")]
      : [
          part([0.1, 0.62, 0.1], [0, 0.31, 0], "secondary"),
          part([0.1, 0.46, 0.1], [-0.19, 0.23, 0.03], "secondary", 0, -0.28),
          part([0.1, 0.54, 0.1], [0.2, 0.27, -0.04], "secondary", 0, 0.22),
          part([0.31, 0.2, 0.28], [-0.1, 0.56, 0], "accent"),
          part([0.28, 0.18, 0.3], [0.17, 0.48, -0.02], "accent", 0.3),
        ];
  } else if (kind === "leaf-litter") {
    parts = lod === "silhouette"
      ? [part([0.92, 0.06, 0.74], [0, 0.04, 0], "accent", 0.14)]
      : [
          part([0.74, 0.045, 0.52], [-0.12, 0.03, 0.02], "accent", 0.1),
          part([0.5, 0.045, 0.48], [0.18, 0.035, -0.08], "secondary", -0.22),
          part([0.38, 0.04, 0.32], [-0.27, 0.028, -0.18], "base", 0.38),
        ];
  } else if (kind === "shelf-mushroom") {
    parts = lod === "silhouette"
      ? [part([0.58, 0.16, 0.48], [0, 0, 0], "accent"), part([0.22, 0.08, 0.2], [0, -0.1, 0], "secondary")]
      : [
          part([0.2, 0.14, 0.2], [0, -0.12, 0], "secondary"),
          part([0.58, 0.13, 0.48], [0, -0.01, 0], "accent"),
          part([0.42, 0.045, 0.34], [0, -0.095, 0], "secondary"),
        ];
  } else if (kind === "reed") {
    const stems = lod === "silhouette" ? 2 : 3;
    parts = Array.from({ length: stems }, (_, index) => part(
      [0.09, [1.12, 1.28, 0.94][index]!, 0.09],
      [(-0.16 + index * 0.17), [0.56, 0.64, 0.47][index]!, 0],
      index === 1 ? "accent" : "base",
      index * 0.12,
      [-0.1, 0.04, 0.12][index]!,
    ));
  } else {
    parts = lod === "silhouette"
      ? [part([0.48, 0.88, 0.52], [0, 0.44, 0], "base"), part([0.26, 0.5, 0.28], [-0.2, 0.22, 0.16], "accent", 0.2, 0.12)]
      : [
          part([0.18, 0.72, 0.18], [0, 0.36, 0], "base"),
          part([0.14, 0.54, 0.14], [-0.2, 0.27, 0.03], "secondary", 0, -0.24),
          part([0.14, 0.62, 0.14], [0.2, 0.31, -0.02], "accent", 0, 0.2),
        ];
  }
  return Object.freeze(parts.map((entry) => Object.freeze(entry)));
}

function canonicalCandidates(candidates: readonly NaturalDecorationCandidate[]): NaturalDecorationCandidate[] {
  const unique = new Map<string, NaturalDecorationCandidate>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)
      || (candidate.y !== undefined && !Number.isFinite(candidate.y))) continue;
    const x = candidate.support === "tree" ? candidate.x : Math.round(candidate.x * 2) / 2;
    const z = candidate.support === "tree" ? candidate.z : Math.round(candidate.z * 2) / 2;
    // Preserve the actual terrain/water datum; ocean tops need not be half-integers.
    const y = candidate.y;
    const key = `${candidate.support}:${x}:${y ?? ""}:${z}:${candidate.supportTreeIndex ?? ""}`;
    unique.set(key, {
      x, z, support: candidate.support,
      ...(y === undefined ? {} : { y }),
      ...(candidate.supportTreeIndex === undefined ? {} : { supportTreeIndex: candidate.supportTreeIndex }),
      ...(candidate.treeSupport === undefined ? {} : { treeSupport: { ...candidate.treeSupport } }),
    });
  }
  return [...unique.values()].sort(compareCandidate);
}

function chooseCandidate(candidates: readonly NaturalDecorationCandidate[], prefix: string, role: string): NaturalDecorationCandidate | undefined {
  return candidates
    .map((candidate) => ({ candidate, rank: hash32(`${prefix}:${role}:${candidate.x}:${candidate.z}`) }))
    .sort((left, right) => left.rank - right.rank || compareCandidate(left.candidate, right.candidate))[0]?.candidate;
}

function placement(prefix: string, kind: NaturalDecorationKind, candidate: NaturalDecorationCandidate, scale: number): NaturalDecorationPlacement {
  const rank = hash32(`${prefix}:shape:${candidate.x}:${candidate.y ?? ""}:${candidate.z}:${candidate.supportTreeIndex ?? ""}:${kind}`);
  const treeContact = kind === "shelf-mushroom" && candidate.treeSupport
    ? naturalTreeMushroomContactPlacement(candidate.treeSupport, scale)
    : undefined;
  return {
    id: `${prefix}:${kind}:${candidate.support}:${treeContact?.x ?? candidate.x}:${candidate.y ?? ""}:${treeContact?.z ?? candidate.z}:${candidate.supportTreeIndex ?? ""}`,
    kind,
    support: candidate.support,
    x: treeContact?.x ?? candidate.x,
    z: treeContact?.z ?? candidate.z,
    ...(candidate.y === undefined ? {} : { y: candidate.y }),
    ...(candidate.supportTreeIndex === undefined ? {} : { supportTreeIndex: candidate.supportTreeIndex }),
    ...(candidate.treeSupport === undefined ? {} : { treeSupport: { ...candidate.treeSupport } }),
    rotationY: treeContact?.rotationY ?? ((rank % 16) / 16) * Math.PI * 2,
    variant: (rank >>> 16) % 4,
    scale,
  };
}

function kindForDetail(style: EnvironmentStyle, support: NaturalDecorationSupport, rank: number): NaturalDecorationKind | undefined {
  const roll = rank % 100;
  if (support === "tree") return rank % 100 < 32 ? "shelf-mushroom" : undefined;
  if (support === "water") {
    if (style !== "ocean-island") return undefined;
    return roll < 46 ? "coral" : roll < 78 ? "reed" : roll < 92 ? "rock" : undefined;
  }
  if (style === "natural-valley") return roll < 18 ? "rock" : roll < 47 ? "grass-tuft" : roll < 70 ? "flower" : roll < 85 ? "red-shrub" : "leaf-litter";
  if (style === "ocean-island") return roll < 15 ? "rock" : roll < 54 ? "grass-tuft" : "flower";
  return roll < 20 ? "rock" : roll < 58 ? "grass-tuft" : "flower";
}

function compareCandidate(left: NaturalDecorationCandidate, right: NaturalDecorationCandidate): number {
  return left.x - right.x || left.z - right.z || (left.y ?? 0) - (right.y ?? 0)
    || (left.support < right.support ? -1 : left.support > right.support ? 1 : 0);
}

function distanceSquared(point: { x: number; z: number }, candidate: NaturalDecorationCandidate): number {
  return (point.x - candidate.x) ** 2 + (point.z - candidate.z) ** 2;
}

function unitHash(value: string): number {
  return hash32(value) / 0x1_0000_0000;
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
