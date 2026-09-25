import { decodeResourcePackSpecialTexture, type ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";

type ChestShape = "single" | "left" | "right";
type HorizontalFacing = "north" | "south" | "west" | "east";
type ShulkerFacing = HorizontalFacing | "up" | "down";
type ModelFace = "down" | "up" | "west" | "north" | "east" | "south";

interface ModelCuboid {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  texU: number;
  texV: number;
  omitFace?: ModelFace;
}

interface BoxEntry {
  voxel: BlueprintVoxel;
  facing: HorizontalFacing | ShulkerFacing;
}

type BoxGroup =
  | {
    key: string;
    kind: "chest";
    shape: ChestShape;
    texture: ResourcePackSpecialTexture;
    entries: BoxEntry[];
  }
  | {
    key: string;
    kind: "shulker_box";
    shape: "shulker";
    texture: ResourcePackSpecialTexture;
    entries: BoxEntry[];
  };

type ResolvedSpecialBox =
  | { kind: "chest"; shape: ChestShape; resourceId: string; facing: HorizontalFacing }
  | { kind: "shulker_box"; shape: "shulker"; resourceId: string; facing: ShulkerFacing };

const VANILLA_NAMESPACE = "minecraft:";
const MODEL_TEXTURE_SIZE = 64;
const SHULKER_RENDER_SCALE = 0.9995;

const DYE_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

const chestTextureForBlock = new Map<string, string>([
  ["chest", "normal"],
  ["trapped_chest", "trapped"],
  ["ender_chest", "ender"],
  ["copper_chest", "copper"],
  ["exposed_copper_chest", "copper_exposed"],
  ["weathered_copper_chest", "copper_weathered"],
  ["oxidized_copper_chest", "copper_oxidized"],
]);

const CHEST_SINGLE_CUBOIDS: readonly ModelCuboid[] = [
  { name: "bottom", x: 1, y: 0, z: 1, width: 14, height: 10, depth: 14, texU: 0, texV: 19 },
  { name: "lid", x: 1, y: 9, z: 1, width: 14, height: 5, depth: 14, texU: 0, texV: 0 },
  { name: "lock", x: 7, y: 7, z: 15, width: 2, height: 4, depth: 1, texU: 0, texV: 0 },
];

const CHEST_DOUBLE_CUBOIDS: Readonly<Record<Exclude<ChestShape, "single">, readonly ModelCuboid[]>> = {
  right: [
    { name: "bottom", x: 1, y: 0, z: 1, width: 15, height: 10, depth: 14, texU: 0, texV: 19, omitFace: "east" },
    { name: "lid", x: 1, y: 9, z: 1, width: 15, height: 5, depth: 14, texU: 0, texV: 0, omitFace: "east" },
    { name: "lock", x: 15, y: 7, z: 15, width: 1, height: 4, depth: 1, texU: 0, texV: 0, omitFace: "east" },
  ],
  left: [
    { name: "bottom", x: 0, y: 0, z: 1, width: 15, height: 10, depth: 14, texU: 0, texV: 19, omitFace: "west" },
    { name: "lid", x: 0, y: 9, z: 1, width: 15, height: 5, depth: 14, texU: 0, texV: 0, omitFace: "west" },
    { name: "lock", x: 0, y: 7, z: 15, width: 1, height: 4, depth: 1, texU: 0, texV: 0, omitFace: "west" },
  ],
};

const SHULKER_CUBOIDS: readonly ModelCuboid[] = [
  // Mojang's ShulkerModel.createShellMesh(), with the closed-state lid pose y=24.
  { name: "lid", x: -8, y: 8, z: -8, width: 16, height: 12, depth: 16, texU: 0, texV: 0 },
  { name: "base", x: -8, y: 16, z: -8, width: 16, height: 8, depth: 16, texU: 0, texV: 28 },
];

const MODEL_FACES: readonly {
  face: ModelFace;
  normal: readonly [number, number, number];
  cornerIndices: readonly [number, number, number, number];
  uv: (cuboid: ModelCuboid) => readonly [number, number, number, number];
}[] = [
  {
    face: "down", normal: [0, -1, 0], cornerIndices: [5, 4, 0, 1],
    uv: ({ texU: u, texV: v, width: w, depth: d }) => [u + d, v, u + d + w, v + d],
  },
  {
    face: "up", normal: [0, 1, 0], cornerIndices: [2, 3, 7, 6],
    uv: ({ texU: u, texV: v, width: w, depth: d }) => [u + d + w, v + d, u + d + w + d, v],
  },
  {
    face: "west", normal: [-1, 0, 0], cornerIndices: [0, 4, 7, 3],
    uv: ({ texU: u, texV: v, depth: d, height: h }) => [u, v + d, u + d, v + d + h],
  },
  {
    face: "north", normal: [0, 0, -1], cornerIndices: [1, 0, 3, 2],
    uv: ({ texU: u, texV: v, width: w, depth: d, height: h }) => [u + d, v + d, u + d + w, v + d + h],
  },
  {
    face: "east", normal: [1, 0, 0], cornerIndices: [5, 1, 2, 6],
    uv: ({ texU: u, texV: v, width: w, depth: d, height: h }) => [u + d + w, v + d, u + d + w + d, v + d + h],
  },
  {
    face: "south", normal: [0, 0, 1], cornerIndices: [4, 5, 6, 7],
    uv: ({ texU: u, texV: v, width: w, depth: d, height: h }) => [u + d + w + d, v + d, u + d + w + d + w, v + d + h],
  },
];

/**
 * Static Minecraft Java 26.3 block-entity geometry for chests and shulker boxes.
 * Opening state, inventories, Christmas textures, and block-entity NBT are not
 * present in blueprints, so these use the exact closed model only.
 */
export function addResourceSpecialBoxes(
  root: THREE.Group,
  voxels: readonly BlueprintVoxel[],
  specialTextures: readonly ResourcePackSpecialTexture[],
): Set<BlueprintVoxel> {
  const texturesById = new Map<string, ResourcePackSpecialTexture>();
  for (const texture of specialTextures) {
    if (!texturesById.has(texture.resourceId)) texturesById.set(texture.resourceId, texture);
  }

  const groups = new Map<string, BoxGroup>();
  for (const voxel of voxels) {
    const resolved = resolveSpecialBox(voxel);
    if (!resolved) continue;
    const texture = texturesById.get(resolved.resourceId);
    if (!texture) continue;
    const groupKey = `${resolved.kind}|${resolved.resourceId}|${resolved.shape}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = resolved.kind === "chest"
        ? { key: groupKey, kind: "chest", shape: resolved.shape, texture, entries: [] }
        : { key: groupKey, kind: "shulker_box", shape: "shulker", texture, entries: [] };
      groups.set(groupKey, group);
    }
    if (!group) continue;
    group.entries.push({ voxel, facing: resolved.facing });
  }

  const handled = new Set<BlueprintVoxel>();
  for (const group of groups.values()) {
    let pixels: Uint8Array;
    try {
      pixels = decodeResourcePackSpecialTexture(group.texture);
    } catch {
      // The renderer is a fallback boundary: a malformed in-memory manifest
      // must not break the rest of the blueprint/world.
      continue;
    }

    const texture = new THREE.DataTexture(
      pixels,
      group.texture.width,
      group.texture.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.name = `blockcolc-special-${group.texture.resourceId}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 2;
    texture.flipY = true;
    texture.needsUpdate = true;

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      roughness: group.kind === "chest" ? 0.82 : 0.9,
      metalness: 0,
      side: THREE.FrontSide,
    });
    material.name = `blockcolc-special-${group.kind}-${group.shape}`;

    const cuboids = group.kind === "shulker_box"
      ? SHULKER_CUBOIDS
      : group.shape === "single"
        ? CHEST_SINGLE_CUBOIDS
        : CHEST_DOUBLE_CUBOIDS[group.shape];
    const pointTransform = group.kind === "shulker_box" ? toShulkerModelPoint : toChestModelPoint;
    const geometry = createModelGeometry(cuboids, pointTransform, group.kind === "shulker_box" ? SHULKER_RENDER_SCALE : 1);
    geometry.name = `blockcolc-special-geometry-${group.kind}-${group.shape}`;

    const mesh = new THREE.InstancedMesh(geometry, material, group.entries.length);
    mesh.name = `blockcolc-special-${group.kind}-${group.shape}`;
    mesh.userData.specialBlockKind = group.kind;
    mesh.userData.specialShape = group.shape;
    mesh.userData.specialTextureResourceId = group.texture.resourceId;
    mesh.userData.ownedMaterial = material;
    mesh.userData.ownedTexture = texture;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index]!;
      position.set(entry.voxel.x, entry.voxel.y, entry.voxel.z);
      if (group.kind === "shulker_box") {
        const facing = entry.facing as ShulkerFacing;
        quaternion.setFromRotationMatrix(shulkerDirectionMatrix(facing));
        scale.set(1, 1, 1);
      } else {
        quaternion.setFromAxisAngle(THREE_Y_AXIS, chestYaw(entry.facing as HorizontalFacing));
        scale.set(1, 1, 1);
      }
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      handled.add(entry.voxel);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }

  return handled;
}

function resolveSpecialBox(voxel: BlueprintVoxel): ResolvedSpecialBox | undefined {
  const sourceBlockId = voxel.sourceBlockId?.toLowerCase();
  if (!sourceBlockId?.startsWith(VANILLA_NAMESPACE)) return undefined;
  const name = sourceBlockId.slice(VANILLA_NAMESPACE.length);
  const state = voxel.sourceBlockState ?? {};

  if (name === "ender_chest") {
    const facing = horizontalFacing(state.facing, "north");
    return facing ? {
      kind: "chest", shape: "single", resourceId: "minecraft:entity/chest/ender", facing,
    } : undefined;
  }

  const chestTexture = chestTextureForName(name);
  if (chestTexture) {
    const shape = chestShape(state.type);
    const facing = horizontalFacing(state.facing, "north");
    if (!shape || !facing) return undefined;
    const textureName = shape === "single" ? chestTexture : `${chestTexture}_${shape}`;
    return {
      kind: "chest", shape,
      resourceId: `minecraft:entity/chest/${textureName}`,
      facing,
    };
  }

  const shulkerTexture = shulkerTextureForName(name);
  if (shulkerTexture) {
    const facing = shulkerFacing(state.facing);
    return facing ? {
      kind: "shulker_box", shape: "shulker",
      resourceId: `minecraft:entity/shulker/${shulkerTexture}`,
      facing,
    } : undefined;
  }

  return undefined;
}

function chestTextureForName(name: string): string | undefined {
  const waxed = name.startsWith("waxed_");
  const baseName = waxed ? name.slice("waxed_".length) : name;
  return chestTextureForBlock.get(baseName);
}

function chestShape(value: string | undefined): ChestShape | undefined {
  if (value === undefined || value === "single") return "single";
  if (value === "left" || value === "right") return value;
  return undefined;
}

function horizontalFacing(value: string | undefined, fallback: HorizontalFacing): HorizontalFacing | undefined {
  if (value === undefined) return fallback;
  return value === "north" || value === "south" || value === "west" || value === "east" ? value : undefined;
}

function shulkerFacing(value: string | undefined): ShulkerFacing | undefined {
  if (value === undefined) return "up";
  return value === "up" || value === "down" || value === "north" || value === "south" || value === "west" || value === "east"
    ? value
    : undefined;
}

function shulkerTextureForName(name: string): string | undefined {
  if (name === "shulker_box") return "shulker";
  const suffix = "_shulker_box";
  if (!name.endsWith(suffix)) return undefined;
  const color = name.slice(0, -suffix.length);
  return DYE_COLORS.includes(color as (typeof DYE_COLORS)[number]) ? `shulker_${color}` : undefined;
}

function chestYaw(facing: HorizontalFacing): number {
  // ChestRenderer applies -Direction.toYRot(), with the model's lock facing +Z.
  switch (facing) {
    case "south": return 0;
    case "north": return Math.PI;
    case "west": return -Math.PI / 2;
    case "east": return Math.PI / 2;
  }
}

function toChestModelPoint(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x / 16 - 0.5, y / 16 - 0.5, z / 16 - 0.5);
}

function toShulkerModelPoint(x: number, y: number, z: number): THREE.Vector3 {
  // ShulkerBoxRenderer: T(.5) * R(direction) * S(1,-1,-1) * T(0,-1,0).
  // Store the direction-independent, center-relative reflection in the mesh;
  // the per-instance quaternion supplies R(direction).
  return new THREE.Vector3(x / 16, 1 - y / 16, -z / 16);
}

function createModelGeometry(
  cuboids: readonly ModelCuboid[],
  transformPoint: (x: number, y: number, z: number) => THREE.Vector3,
  scale: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cuboidInfo: Array<{ name: string; from: [number, number, number]; to: [number, number, number]; texU: number; texV: number; faces: number }> = [];

  for (const cuboid of cuboids) {
    const x0 = cuboid.x;
    const y0 = cuboid.y;
    const z0 = cuboid.z;
    const x1 = x0 + cuboid.width;
    const y1 = y0 + cuboid.height;
    const z1 = z0 + cuboid.depth;
    const corners = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ] as const;
    let faceCount = 0;
    for (const face of MODEL_FACES) {
      if (face.face === cuboid.omitFace) continue;
      const [u0, v0, u1, v1] = face.uv(cuboid);
      const faceUvs = [[u1, v0], [u0, v0], [u0, v1], [u1, v1]] as const;
      const base = positions.length / 3;
      for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
        const corner = corners[face.cornerIndices[vertexIndex]!]!;
        const point = transformPoint(corner[0], corner[1], corner[2]).multiplyScalar(scale);
        positions.push(point.x, point.y, point.z);
        normals.push(...transformModelDirection(face.normal, transformPoint));
        const uv = faceUvs[vertexIndex]!;
        uvs.push(uv[0] / MODEL_TEXTURE_SIZE, uv[1] / MODEL_TEXTURE_SIZE);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      faceCount += 1;
    }
    cuboidInfo.push({
      name: cuboid.name,
      from: [x0, y0, z0],
      to: [x1, y1, z1],
      texU: cuboid.texU,
      texV: cuboid.texV,
      faces: faceCount,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.specialBoxCuboids = cuboidInfo;
  geometry.userData.javaModelTextureSize = MODEL_TEXTURE_SIZE;
  return geometry;
}

function transformModelDirection(
  direction: readonly [number, number, number],
  transformPoint: (x: number, y: number, z: number) => THREE.Vector3,
): [number, number, number] {
  const transformed = transformPoint(direction[0], direction[1], direction[2])
    .sub(transformPoint(0, 0, 0))
    .normalize();
  return [transformed.x, transformed.y, transformed.z];
}

function shulkerDirectionMatrix(facing: ShulkerFacing): THREE.Matrix4 {
  const rotate = (vector: readonly [number, number, number]): THREE.Vector3 => {
    const [x, y, z] = vector;
    switch (facing) {
      case "up": return new THREE.Vector3(x, y, z);
      case "down": return new THREE.Vector3(x, -y, -z);
      case "north": return new THREE.Vector3(-x, -z, -y);
      case "south": return new THREE.Vector3(x, -z, y);
      case "west": return new THREE.Vector3(-y, -z, x);
      case "east": return new THREE.Vector3(y, -z, -x);
    }
  };
  return new THREE.Matrix4().makeBasis(
    rotate([1, 0, 0]),
    rotate([0, 1, 0]),
    rotate([0, 0, 1]),
  );
}

const THREE_Y_AXIS = new THREE.Vector3(0, 1, 0);
