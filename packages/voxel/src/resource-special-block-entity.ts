import * as THREE from "three";
import type {
  BlueprintCampfireSlot,
  BlueprintSignFace,
  BlueprintVoxel,
  CampfireSlotIndex,
  SignDyeColor,
} from "./blueprint";

const SIGN_TEXTURE_COLUMNS = 8;
const SIGN_TEXTURE_ROWS = 8;
const SIGN_FACE_WIDTH = 128;
const SIGN_FACE_HEIGHT = 64;
const SIGN_TEXTURE_WIDTH = SIGN_TEXTURE_COLUMNS * SIGN_FACE_WIDTH;
const SIGN_TEXTURE_HEIGHT = SIGN_TEXTURE_ROWS * SIGN_FACE_HEIGHT;
// A single no-mipmap 1024x512 RGBA atlas is a fixed 2 MiB allocation per
// renderer rebuild. It contains at most 64 distinct front/back face patterns.
const MAX_UNIQUE_SIGN_FACES = SIGN_TEXTURE_COLUMNS * SIGN_TEXTURE_ROWS;
// Keep the added sign surfaces and campfire block-entity work bounded even
// for large imported blueprints; overflow remains on the ordinary block path.
const MAX_SIGN_BLOCKS_PER_RENDERER = 256;
const MAX_SIGN_TEXT_FACES_PER_RENDERER = MAX_SIGN_BLOCKS_PER_RENDERER * 2;
const MAX_CAMPFIRE_BLOCKS_PER_RENDERER = 256;
const MAX_CAMPFIRE_ITEM_MARKERS_PER_RENDERER = MAX_CAMPFIRE_BLOCKS_PER_RENDERER * 4 * 3;
const CAMPFIRE_MARKER_LOCAL_Y = 0.26171875 - 0.5;
const SIGN_LIMITATIONS = [
  "Sign boards use approximate local geometry and generic wood coloring; exact wood species models require vanilla or user resource-pack model support.",
  "Text uses a bounded local CanvasTexture and system-font fallback (Minecraft, Noto Sans, Segoe UI, sans-serif); the original Minecraft font is not bundled.",
  "Glowing text is a static raster halo, not Minecraft emissive lighting or animated bloom.",
];
const CAMPFIRE_LIMITATIONS = [
  "Campfire slot positions are a deterministic four-corner approximation rotated by block facing; exact vanilla per-slot item transforms are not reproduced.",
  "Each item is shown as a static colored octahedron derived deterministically from its item ID, with at most three tokens to suggest stack count; exact item models, components, and count labels are not rendered.",
  "Fallback campfire logs and fire are simplified static geometry; no fire animation or smoke is simulated.",
];

const DYE_COLOR_HEX: Readonly<Record<SignDyeColor, number>> = {
  white: 0xf9fffe,
  orange: 0xf9801d,
  magenta: 0xc74ebd,
  light_blue: 0x3ab3da,
  yellow: 0xfed83d,
  lime: 0x80c71f,
  pink: 0xf38baa,
  gray: 0x474f52,
  light_gray: 0x9d9d97,
  cyan: 0x169c9c,
  purple: 0x8932b8,
  blue: 0x3c44aa,
  brown: 0x835432,
  green: 0x5e7c16,
  red: 0xb02e26,
  black: 0x1d1d21,
};

type SignMounting = "standing" | "wall" | "hanging" | "wall-hanging";
type CardinalFacing = "north" | "south" | "east" | "west";

/**
 * Approximate static display instructions for one imported sign. The block
 * orientation and per-face text/dye/glow are preserved; the board itself is a
 * small local model and is not a vanilla model parity claim.
 */
export interface StaticSignDisplayPlan {
  voxel: BlueprintVoxel;
  mounting: SignMounting;
  yaw: number;
  boardWidth: number;
  boardHeight: number;
  boardDepth: number;
  boardCenterY: number;
  boardCenterZ: number;
  front: BlueprintSignFace;
  back: BlueprintSignFace;
}

/**
 * Approximate static campfire item placement. Slot IDs remain distinct and
 * facing rotates the four-corner layout; marker color/size/yaw are stable
 * derivatives of the item ID, not Minecraft item models.
 */
export interface StaticCampfireItemMarkerPlan {
  voxel: BlueprintVoxel;
  slot: CampfireSlotIndex;
  itemId: string;
  count: number;
  x: number;
  y: number;
  z: number;
  stackTokenCount: number;
  appearance: StaticItemMarkerAppearance;
}

export interface StaticItemMarkerAppearance {
  hash: number;
  hueDegrees: number;
  saturation: number;
  lightness: number;
  scale: number;
  yaw: number;
}

export interface StaticBlockEntityDisplayRenderer {
  /** Adds approximate block-entity visuals and returns fallback blocks it replaced. */
  add(
    root: THREE.Group,
    visibleVoxels: readonly BlueprintVoxel[],
    visibleFallbackVoxels: readonly BlueprintVoxel[],
  ): Set<BlueprintVoxel>;
  /** Called after the owning building group has disposed the previous scene. */
  reset(): void;
}

const CAMPFIRE_SLOT_CORNERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -0.125, z: -0.125 },
  { x: -0.125, z: 0.125 },
  { x: 0.125, z: 0.125 },
  { x: 0.125, z: -0.125 },
];

/** Returns the model yaw that points local +Z toward a vanilla cardinal facing. */
export function blockEntityFacingYaw(value: string | undefined, fallback: CardinalFacing = "south"): number {
  const facing = isCardinalFacing(value) ? value : fallback;
  return {
    south: 0,
    west: -Math.PI / 2,
    north: Math.PI,
    east: Math.PI / 2,
  }[facing];
}

/** Vanilla floor-sign rotations increase clockwise when viewed from above. */
export function standingSignYaw(value: string | undefined): number {
  const rotation = Number(value);
  return Number.isInteger(rotation) && rotation >= 0 && rotation < 16
    ? -rotation * Math.PI / 8
    : 0;
}

export function planStaticSignDisplay(voxel: BlueprintVoxel): StaticSignDisplayPlan | null {
  const blockId = voxel.sourceBlockId ?? "";
  const path = blockId.startsWith("minecraft:") ? blockId.slice("minecraft:".length) : "";
  if (!voxel.sign || !/^[a-z0-9_]*sign$/.test(path)) return null;

  const wall = path.includes("wall_");
  const hanging = path.includes("hanging_sign");
  const mounting: SignMounting = wall
    ? hanging ? "wall-hanging" : "wall"
    : hanging ? "hanging" : "standing";
  const state = voxel.sourceBlockState ?? {};
  const yaw = wall
    ? blockEntityFacingYaw(state.facing)
    : standingSignYaw(state.rotation);
  const boardWidth = hanging ? 0.9 : 0.875;
  const boardHeight = hanging ? 0.4 : wall ? 0.5 : 0.375;
  const boardCenterY = hanging ? -0.06 : wall ? 0 : 0.14;
  // Wall-sign front faces point away from their supporting wall; the support
  // edge is therefore opposite local +Z before the block-state yaw is applied.
  const boardCenterZ = wall ? -0.42 : 0;

  return {
    voxel,
    mounting,
    yaw,
    boardWidth,
    boardHeight,
    boardDepth: 0.07,
    boardCenterY,
    boardCenterZ,
    front: voxel.sign.front,
    back: voxel.sign.back,
  };
}

export function planStaticCampfireItemMarkers(voxel: BlueprintVoxel): StaticCampfireItemMarkerPlan[] {
  if (!voxel.campfire || !isCampfireBlock(voxel.sourceBlockId)) return [];
  const yaw = blockEntityFacingYaw(voxel.sourceBlockState?.facing);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [...voxel.campfire.slots]
    .filter((slot) => isCampfireSlot(slot) && slot.itemId.length > 0 && slot.count > 0)
    .sort((left, right) => left.slot - right.slot)
    .map((slot) => {
      const corner = CAMPFIRE_SLOT_CORNERS[slot.slot]!;
      return {
        voxel,
        slot: slot.slot,
        itemId: slot.itemId,
        count: slot.count,
        x: cos * corner.x + sin * corner.z,
        y: CAMPFIRE_MARKER_LOCAL_Y,
        z: -sin * corner.x + cos * corner.z,
        stackTokenCount: Math.min(3, slot.count),
        appearance: staticItemMarkerAppearance(slot.itemId),
      };
    });
}

export function staticItemMarkerAppearance(itemId: string): StaticItemMarkerAppearance {
  let hash = 2166136261;
  for (let index = 0; index < itemId.length; index += 1) {
    hash ^= itemId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash >>>= 0;
  return {
    hash,
    hueDegrees: hash % 360,
    saturation: 0.58 + ((hash >>> 9) & 3) * 0.06,
    lightness: 0.43 + ((hash >>> 11) & 3) * 0.035,
    scale: 0.84 + ((hash >>> 13) & 7) * 0.045,
    yaw: ((hash >>> 16) & 15) * Math.PI / 8,
  };
}

export function createStaticBlockEntityDisplayRenderer(): StaticBlockEntityDisplayRenderer {
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let atlasTexture: THREE.CanvasTexture | null = null;
  let canvasUnavailable = false;
  let textureOwnedByScene = false;
  let signTextureCells = new Map<string, { column: number; row: number }>();
  let signBlockCount = 0;
  let signTextFaceCount = 0;
  let campfireBlockCount = 0;
  let campfireMarkerCount = 0;
  const signGeometryTemplates = new Map<SignMounting, THREE.BufferGeometry>();
  let campfireWoodTemplate: THREE.BufferGeometry | null = null;

  const reset = (): void => {
    if (atlasTexture && !textureOwnedByScene) atlasTexture.dispose();
    for (const geometry of signGeometryTemplates.values()) geometry.dispose();
    campfireWoodTemplate?.dispose();
    canvas = null;
    context = null;
    atlasTexture = null;
    canvasUnavailable = false;
    textureOwnedByScene = false;
    signTextureCells = new Map();
    signBlockCount = 0;
    signTextFaceCount = 0;
    campfireBlockCount = 0;
    campfireMarkerCount = 0;
    signGeometryTemplates.clear();
    campfireWoodTemplate = null;
  };

  const add = (
    root: THREE.Group,
    visibleVoxels: readonly BlueprintVoxel[],
    visibleFallbackVoxels: readonly BlueprintVoxel[],
  ): Set<BlueprintVoxel> => {
    const fallback = new Set(visibleFallbackVoxels);
    const handledFallback = new Set<BlueprintVoxel>();
    const fallbackSigns = new Map<SignMounting, StaticSignDisplayPlan[]>();
    const fallbackCampfires: BlueprintVoxel[] = [];
    const campfireMarkers: StaticCampfireItemMarkerPlan[] = [];
    const signTextPositions: number[] = [];
    const signTextUvs: number[] = [];
    const signTextIndices: number[] = [];

    for (const voxel of visibleVoxels) {
      const signPlan = planStaticSignDisplay(voxel);
      if (signPlan) {
        if (signBlockCount >= MAX_SIGN_BLOCKS_PER_RENDERER) continue;
        signBlockCount += 1;
        if (fallback.has(voxel)) {
          const batch = fallbackSigns.get(signPlan.mounting) ?? [];
          batch.push(signPlan);
          fallbackSigns.set(signPlan.mounting, batch);
          handledFallback.add(voxel);
        }
        appendSignFace(signPlan, signPlan.front, false, signTextPositions, signTextUvs, signTextIndices);
        appendSignFace(signPlan, signPlan.back, true, signTextPositions, signTextUvs, signTextIndices);
        continue;
      }

      if (!voxel.campfire || !isCampfireBlock(voxel.sourceBlockId)) continue;
      if (campfireBlockCount >= MAX_CAMPFIRE_BLOCKS_PER_RENDERER) continue;
      campfireBlockCount += 1;
      if (fallback.has(voxel)) {
        fallbackCampfires.push(voxel);
        handledFallback.add(voxel);
      }
      for (const marker of planStaticCampfireItemMarkers(voxel)) {
        const available = MAX_CAMPFIRE_ITEM_MARKERS_PER_RENDERER - campfireMarkerCount;
        const emitted = Math.min(marker.stackTokenCount, Math.max(0, available));
        if (emitted <= 0) continue;
        campfireMarkers.push({ ...marker, stackTokenCount: emitted });
        campfireMarkerCount += emitted;
      }
    }

    for (const [mounting, plans] of fallbackSigns) addSignBody(root, mounting, plans);
    if (fallbackCampfires.length > 0) addCampfireFallback(root, fallbackCampfires);
    if (signTextIndices.length > 0) addSignText(root, signTextPositions, signTextUvs, signTextIndices);
    if (campfireMarkers.length > 0) addCampfireItemMarkers(root, campfireMarkers);
    return handledFallback;
  };

  const appendSignFace = (
    plan: StaticSignDisplayPlan,
    face: BlueprintSignFace,
    back: boolean,
    positions: number[],
    uvs: number[],
    indices: number[],
  ): void => {
    if (signTextFaceCount >= MAX_SIGN_TEXT_FACES_PER_RENDERER) return;
    if (!face.lines.some((line) => line.length > 0)) return;
    const cell = signFaceTextureCell(face);
    if (!cell) return;
    const signAngle = plan.yaw;
    const localZ = plan.boardCenterZ
      + (back ? -plan.boardDepth / 2 : plan.boardDepth / 2)
      + (back ? -0.003 : 0.003);
    const xDirection = back ? -1 : 1;
    const margin = 2;
    const left = (cell.column * SIGN_FACE_WIDTH + margin) / SIGN_TEXTURE_WIDTH;
    const right = ((cell.column + 1) * SIGN_FACE_WIDTH - margin) / SIGN_TEXTURE_WIDTH;
    const bottom = 1 - ((cell.row + 1) * SIGN_FACE_HEIGHT - margin) / SIGN_TEXTURE_HEIGHT;
    const top = 1 - (cell.row * SIGN_FACE_HEIGHT + margin) / SIGN_TEXTURE_HEIGHT;
    const x0 = -plan.boardWidth / 2;
    const x1 = plan.boardWidth / 2;
    const y0 = plan.boardCenterY - plan.boardHeight / 2;
    const y1 = plan.boardCenterY + plan.boardHeight / 2;
    const vertexOffset = positions.length / 3;
    const points = [
      { x: x0, y: y0, u: left, v: bottom },
      { x: x1, y: y0, u: right, v: bottom },
      { x: x1, y: y1, u: right, v: top },
      { x: x0, y: y1, u: left, v: top },
    ];
    const cos = Math.cos(signAngle);
    const sin = Math.sin(signAngle);
    for (const point of points) {
      const localX = point.x * xDirection;
      positions.push(
        plan.voxel.x + cos * localX + sin * localZ,
        plan.voxel.y + point.y,
        plan.voxel.z - sin * localX + cos * localZ,
      );
      uvs.push(point.u, point.v);
    }
    indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3);
    signTextFaceCount += 1;
  };

  const signFaceTextureCell = (face: BlueprintSignFace): { column: number; row: number } | null => {
    const key = JSON.stringify([face.lines, face.dyeColor, face.glowing]);
    const cached = signTextureCells.get(key);
    if (cached) return cached;
    if (signTextureCells.size >= MAX_UNIQUE_SIGN_FACES || canvasUnavailable) return null;
    if (!ensureCanvasAtlas()) return null;
    const index = signTextureCells.size;
    const cell = { column: index % SIGN_TEXTURE_COLUMNS, row: Math.floor(index / SIGN_TEXTURE_COLUMNS) };
    try {
      drawSignFace(context!, cell, face);
    } catch {
      canvasUnavailable = true;
      return null;
    }
    signTextureCells.set(key, cell);
    atlasTexture!.needsUpdate = true;
    return cell;
  };

  const ensureCanvasAtlas = (): boolean => {
    if (context && atlasTexture) return true;
    if (canvasUnavailable || typeof document === "undefined") {
      canvasUnavailable = true;
      return false;
    }
    try {
      canvas = document.createElement("canvas");
      canvas.width = SIGN_TEXTURE_WIDTH;
      canvas.height = SIGN_TEXTURE_HEIGHT;
      context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        canvas = null;
        canvasUnavailable = true;
        return false;
      }
      atlasTexture = new THREE.CanvasTexture(canvas);
      atlasTexture.name = "blockcolc-approx-sign-text-atlas";
      atlasTexture.colorSpace = THREE.SRGBColorSpace;
      atlasTexture.generateMipmaps = false;
      atlasTexture.minFilter = THREE.LinearFilter;
      atlasTexture.magFilter = THREE.LinearFilter;
      atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
      atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
      return true;
    } catch {
      canvas = null;
      context = null;
      atlasTexture?.dispose();
      atlasTexture = null;
      canvasUnavailable = true;
      return false;
    }
  };

  const addSignBody = (root: THREE.Group, mounting: SignMounting, plans: readonly StaticSignDisplayPlan[]): void => {
    const template = signGeometryTemplate(mounting);
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0x855a3a,
      roughness: 0.92,
      metalness: 0,
    });
    const mesh = new THREE.InstancedMesh(template.clone(), meshMaterial, plans.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    plans.forEach((plan, index) => {
      position.set(plan.voxel.x, plan.voxel.y, plan.voxel.z);
      rotation.setFromAxisAngle(Y_AXIS, plan.yaw);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.specialBlockKind = "approximate_sign_board_" + mounting;
    mesh.userData.blockEntityDataLimitations = SIGN_LIMITATIONS;
    mesh.userData.ownedMaterial = meshMaterial;
    root.add(mesh);
  };

  const addSignText = (root: THREE.Group, positions: number[], uvs: number[], indices: number[]): void => {
    const texture = atlasTexture;
    if (!texture || positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const meshMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    meshMaterial.name = "blockcolc-approx-sign-text";
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    mesh.name = "approximateSignTextFaces";
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.specialBlockKind = "approximate_sign_text";
    mesh.userData.blockEntityDataLimitations = SIGN_LIMITATIONS;
    mesh.userData.ownedMaterial = meshMaterial;
    if (!textureOwnedByScene) {
      mesh.userData.ownedTexture = texture;
      textureOwnedByScene = true;
    }
    root.add(mesh);
  };

  const addCampfireFallback = (root: THREE.Group, voxels: readonly BlueprintVoxel[]): void => {
    const woodTemplate = campfireWoodGeometryTemplate();
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x5f402d, roughness: 0.94 });
    const wood = new THREE.InstancedMesh(woodTemplate.clone(), woodMaterial, voxels.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    voxels.forEach((voxel, index) => {
      position.set(voxel.x, voxel.y, voxel.z);
      rotation.setFromAxisAngle(Y_AXIS, blockEntityFacingYaw(voxel.sourceBlockState?.facing));
      matrix.compose(position, rotation, scale);
      wood.setMatrixAt(index, matrix);
    });
    wood.instanceMatrix.needsUpdate = true;
    wood.castShadow = true;
    wood.receiveShadow = true;
    wood.userData.specialBlockKind = "approximate_campfire_logs";
    wood.userData.blockEntityDataLimitations = CAMPFIRE_LIMITATIONS;
    wood.userData.ownedMaterial = woodMaterial;
    root.add(wood);

    const coalMaterial = new THREE.MeshStandardMaterial({ color: 0x302a25, roughness: 1 });
    const coalGeometry = new THREE.CylinderGeometry(0.22, 0.24, 0.075, 8);
    const coal = new THREE.InstancedMesh(coalGeometry, coalMaterial, voxels.length);
    voxels.forEach((voxel, index) => {
      position.set(voxel.x, voxel.y - 0.3, voxel.z);
      matrix.compose(position, new THREE.Quaternion(), scale);
      coal.setMatrixAt(index, matrix);
    });
    coal.instanceMatrix.needsUpdate = true;
    coal.castShadow = false;
    coal.receiveShadow = true;
    coal.userData.specialBlockKind = "approximate_campfire_coals";
    coal.userData.blockEntityDataLimitations = CAMPFIRE_LIMITATIONS;
    coal.userData.ownedMaterial = coalMaterial;
    root.add(coal);

    for (const [kind, colour] of [["campfire", 0xe97532], ["soul_campfire", 0x5bc2d2]] as const) {
      const lit = voxels.filter((voxel) => voxel.sourceBlockId === "minecraft:" + kind
        && voxel.sourceBlockState?.lit !== "false");
      if (lit.length === 0) continue;
      const fireMaterial = new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: kind === "soul_campfire" ? 0.55 : 0.32,
        roughness: 0.76,
      });
      const fire = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.25, 5), fireMaterial, lit.length);
      lit.forEach((voxel, index) => {
        position.set(voxel.x, voxel.y - 0.14, voxel.z);
        matrix.compose(position, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        fire.setMatrixAt(index, matrix);
      });
      fire.instanceMatrix.needsUpdate = true;
      fire.castShadow = false;
      fire.receiveShadow = false;
      fire.userData.specialBlockKind = "approximate_static_" + kind + "_fire";
      fire.userData.blockEntityDataLimitations = CAMPFIRE_LIMITATIONS;
      fire.userData.ownedMaterial = fireMaterial;
      root.add(fire);
    }
  };

  const addCampfireItemMarkers = (root: THREE.Group, plans: readonly StaticCampfireItemMarkerPlan[]): void => {
    if (plans.length === 0) return;
    const tokenPlans: Array<{
      plan: StaticCampfireItemMarkerPlan;
      stackIndex: number;
    }> = [];
    for (const plan of plans) {
      for (let stackIndex = 0; stackIndex < plan.stackTokenCount; stackIndex += 1) {
        tokenPlans.push({ plan, stackIndex });
      }
    }
    if (tokenPlans.length === 0) return;
    const geometry = new THREE.OctahedronGeometry(0.5, 0);
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.02,
    });
    const mesh = new THREE.InstancedMesh(geometry, meshMaterial, tokenPlans.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    tokenPlans.forEach(({ plan, stackIndex }, index) => {
      const appearance = plan.appearance;
      position.set(plan.voxel.x + plan.x, plan.voxel.y + plan.y + stackIndex * 0.045, plan.voxel.z + plan.z);
      rotation.setFromAxisAngle(Y_AXIS, appearance.yaw);
      const markerScale = 0.2 * appearance.scale;
      scale.set(markerScale, markerScale, markerScale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new THREE.Color().setHSL(
        appearance.hueDegrees / 360,
        appearance.saturation,
        appearance.lightness,
      ));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.specialBlockKind = "approximate_campfire_item_markers";
    mesh.userData.blockEntityDataLimitations = CAMPFIRE_LIMITATIONS;
    mesh.userData.itemSlots = plans.map((plan) => plan.slot);
    mesh.userData.itemIds = plans.map((plan) => plan.itemId);
    mesh.userData.itemCounts = plans.map((plan) => plan.count);
    mesh.userData.ownedMaterial = meshMaterial;
    root.add(mesh);
  };

  const signGeometryTemplate = (mounting: SignMounting): THREE.BufferGeometry => {
    const cached = signGeometryTemplates.get(mounting);
    if (cached) return cached;
    const sample = signBodyDimensions(mounting);
    const parts: GeometryPart[] = [{
      size: [sample.boardWidth, sample.boardHeight, 0.07],
      position: [0, sample.boardCenterY, sample.boardCenterZ],
    }];
    if (mounting === "standing") {
      parts.push({ size: [0.065, 0.62, 0.065], position: [0, -0.19, 0] });
    } else if (mounting === "wall") {
      parts.push({ size: [0.1, 0.12, 0.12], position: [0, 0, sample.boardCenterZ - 0.08] });
    } else if (mounting === "hanging") {
      parts.push(
        { size: [0.035, 0.31, 0.035], position: [-0.25, 0.325, 0] },
        { size: [0.035, 0.31, 0.035], position: [0.25, 0.325, 0] },
        { size: [0.56, 0.035, 0.035], position: [0, 0.475, 0] },
      );
    } else {
      parts.push(
        { size: [0.035, 0.035, 0.24], position: [-0.25, 0.16, sample.boardCenterZ - 0.075] },
        { size: [0.035, 0.035, 0.24], position: [0.25, 0.16, sample.boardCenterZ - 0.075] },
        { size: [0.56, 0.04, 0.04], position: [0, 0.25, sample.boardCenterZ - 0.19] },
      );
    }
    const geometry = mergeBoxParts(parts);
    geometry.name = "blockcolc-approx-sign-" + mounting;
    signGeometryTemplates.set(mounting, geometry);
    return geometry;
  };

  const campfireWoodGeometryTemplate = (): THREE.BufferGeometry => {
    if (campfireWoodTemplate) return campfireWoodTemplate;
    campfireWoodTemplate = mergeBoxParts([
      { size: [0.86, 0.12, 0.15], position: [0, -0.365, 0], rotationY: Math.PI / 4 },
      { size: [0.86, 0.12, 0.15], position: [0, -0.365, 0], rotationY: -Math.PI / 4 },
    ]);
    campfireWoodTemplate.name = "blockcolc-approx-campfire-crossed-logs";
    return campfireWoodTemplate;
  };

  const signBodyDimensions = (mounting: SignMounting): Pick<
    StaticSignDisplayPlan,
    "boardWidth" | "boardHeight" | "boardCenterY" | "boardCenterZ"
  > => {
    const hanging = mounting === "hanging" || mounting === "wall-hanging";
    const wall = mounting === "wall" || mounting === "wall-hanging";
    return {
      boardWidth: hanging ? 0.9 : 0.875,
      boardHeight: hanging ? 0.4 : wall ? 0.5 : 0.375,
      boardCenterY: hanging ? -0.06 : wall ? 0 : 0.14,
      boardCenterZ: wall ? -0.42 : 0,
    };
  };

  return { add, reset };
}

interface GeometryPart {
  size: readonly [number, number, number];
  position: readonly [number, number, number];
  rotationY?: number;
}

function mergeBoxParts(parts: readonly GeometryPart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const geometry = new THREE.BoxGeometry(...part.size);
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...part.position),
      new THREE.Quaternion().setFromAxisAngle(Y_AXIS, part.rotationY ?? 0),
      new THREE.Vector3(1, 1, 1),
    ));
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    const vertexOffset = positions.length / 3;
    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      uvs.push(uv.getX(index), uv.getY(index));
    }
    const sourceIndex = geometry.getIndex();
    if (sourceIndex) {
      for (let index = 0; index < sourceIndex.count; index += 1) indices.push(vertexOffset + sourceIndex.getX(index));
    }
    geometry.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices);
  return result;
}

function drawSignFace(
  context: CanvasRenderingContext2D,
  cell: { column: number; row: number },
  face: BlueprintSignFace,
): void {
  const x = cell.column * SIGN_FACE_WIDTH;
  const y = cell.row * SIGN_FACE_HEIGHT;
  context.save();
  context.beginPath();
  context.rect(x, y, SIGN_FACE_WIDTH, SIGN_FACE_HEIGHT);
  context.clip();
  context.fillStyle = "#916440";
  context.fillRect(x, y, SIGN_FACE_WIDTH, SIGN_FACE_HEIGHT);
  context.fillStyle = "rgba(54, 33, 22, 0.17)";
  for (let grain = 0; grain < 5; grain += 1) {
    const lineY = y + 8 + grain * 12;
    context.fillRect(x + 3 + (grain % 2) * 7, lineY, SIGN_FACE_WIDTH - 10, 1);
  }
  context.strokeStyle = "#553820";
  context.lineWidth = 2;
  context.strokeRect(x + 1, y + 1, SIGN_FACE_WIDTH - 2, SIGN_FACE_HEIGHT - 2);
  context.strokeStyle = "rgba(231, 196, 148, 0.38)";
  context.lineWidth = 1;
  context.strokeRect(x + 4, y + 4, SIGN_FACE_WIDTH - 8, SIGN_FACE_HEIGHT - 8);

  const colorHex = DYE_COLOR_HEX[face.dyeColor] ?? DYE_COLOR_HEX.black;
  const colorCss = "#" + colorHex.toString(16).padStart(6, "0");
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = colorCss;
  context.strokeStyle = colorCss;
  context.lineWidth = face.glowing ? 1.4 : 0;
  context.shadowColor = colorCss;
  context.shadowBlur = face.glowing ? 5 : 0;
  context.font = "bold 12px Minecraft, 'Noto Sans', 'Segoe UI', sans-serif";
  face.lines.slice(0, 4).forEach((line, index) => {
    const safeLine = line.replace(/[\u0000-\u001f\u007f]/g, "");
    const lineY = y + 10 + index * 14;
    if (face.glowing) context.strokeText(safeLine, x + SIGN_FACE_WIDTH / 2, lineY, SIGN_FACE_WIDTH - 14);
    context.fillText(safeLine, x + SIGN_FACE_WIDTH / 2, lineY, SIGN_FACE_WIDTH - 14);
  });
  context.restore();
}

function isCardinalFacing(value: string | undefined): value is CardinalFacing {
  return value === "north" || value === "south" || value === "east" || value === "west";
}

function isCampfireBlock(value: string | undefined): boolean {
  return value === "minecraft:campfire" || value === "minecraft:soul_campfire";
}

function isCampfireSlot(slot: BlueprintCampfireSlot): slot is BlueprintCampfireSlot {
  return slot.slot === 0 || slot.slot === 1 || slot.slot === 2 || slot.slot === 3;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
