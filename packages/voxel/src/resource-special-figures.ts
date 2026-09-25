import { decodeResourcePackSpecialTexture, type ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";

type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];
type FigureType = "skull-mob" | "skull-humanoid" | "skull-dragon" | "skull-piglin" | `copper-${CopperPose}`;
type CopperPose = "standing" | "running" | "sitting" | "star";

interface CubeSpec {
  uv: readonly [number, number];
  from: Vec3;
  size: Vec3;
  inflate?: number;
  mirror?: boolean;
}

interface PartSpec {
  pivot?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  cubes?: readonly CubeSpec[];
  children?: readonly PartSpec[];
}

interface Candidate {
  voxel: BlueprintVoxel;
  figure: FigureType;
  textureId: string;
  /** Transform from model-local coordinates into the voxel-centered world. */
  position: THREE.Vector3;
  yaw: number;
}

interface FigureDefinition {
  textureSize: readonly [number, number];
  root: PartSpec;
  /** Skull renderers apply scale(-1,-1,1); the statue renderer uses a 180-degree root pose instead. */
  skullBasis: boolean;
}

const SKULL_TEXTURES: Readonly<Record<string, { model: FigureType; textureId: string }>> = {
  "minecraft:skeleton_skull": { model: "skull-mob", textureId: "minecraft:entity/skeleton/skeleton" },
  "minecraft:skeleton_wall_skull": { model: "skull-mob", textureId: "minecraft:entity/skeleton/skeleton" },
  "minecraft:wither_skeleton_skull": { model: "skull-mob", textureId: "minecraft:entity/skeleton/wither_skeleton" },
  "minecraft:wither_skeleton_wall_skull": { model: "skull-mob", textureId: "minecraft:entity/skeleton/wither_skeleton" },
  "minecraft:creeper_head": { model: "skull-mob", textureId: "minecraft:entity/creeper/creeper" },
  "minecraft:creeper_wall_head": { model: "skull-mob", textureId: "minecraft:entity/creeper/creeper" },
  "minecraft:zombie_head": { model: "skull-humanoid", textureId: "minecraft:entity/zombie/zombie" },
  "minecraft:zombie_wall_head": { model: "skull-humanoid", textureId: "minecraft:entity/zombie/zombie" },
  // Block-entity owner profiles are absent from BlueprintVoxel. Vanilla's no-profile
  // fallback is DefaultPlayerSkin (slim Steve), not an arbitrary player texture.
  "minecraft:player_head": { model: "skull-humanoid", textureId: "minecraft:entity/player/slim/steve" },
  "minecraft:player_wall_head": { model: "skull-humanoid", textureId: "minecraft:entity/player/slim/steve" },
  "minecraft:dragon_head": { model: "skull-dragon", textureId: "minecraft:entity/enderdragon/dragon" },
  "minecraft:dragon_wall_head": { model: "skull-dragon", textureId: "minecraft:entity/enderdragon/dragon" },
  "minecraft:piglin_head": { model: "skull-piglin", textureId: "minecraft:entity/piglin/piglin" },
  "minecraft:piglin_wall_head": { model: "skull-piglin", textureId: "minecraft:entity/piglin/piglin" },
};

const COPPER_TEXTURES: Readonly<Record<string, string>> = {
  "copper_golem_statue": "minecraft:entity/copper_golem/copper_golem",
  "exposed_copper_golem_statue": "minecraft:entity/copper_golem/copper_golem_exposed",
  "weathered_copper_golem_statue": "minecraft:entity/copper_golem/copper_golem_weathered",
  "oxidized_copper_golem_statue": "minecraft:entity/copper_golem/copper_golem_oxidized",
};

const COPPER_IDS = Object.freeze(Object.entries(COPPER_TEXTURES).flatMap(([blockName, textureId]) => [
  [`minecraft:${blockName}`, textureId] as const,
  [`minecraft:waxed_${blockName}`, textureId] as const,
]));

const DIRECTIONS: Readonly<Record<string, { stepX: number; stepZ: number; yaw: number }>> = {
  north: { stepX: 0, stepZ: -1, yaw: 0 },
  east: { stepX: 1, stepZ: 0, yaw: -Math.PI / 2 },
  south: { stepX: 0, stepZ: 1, yaw: Math.PI },
  west: { stepX: -1, stepZ: 0, yaw: Math.PI / 2 },
};

const SKULL_CUBE: CubeSpec = { uv: [0, 0], from: [-4, -8, -4], size: [8, 8, 8] };

const HUMANOID_HEAD: readonly CubeSpec[] = [
  SKULL_CUBE,
  // SkullModel.createHumanoidHeadLayer(): the outer hat/helmet shell.
  { uv: [32, 0], from: [-4, -8, -4], size: [8, 8, 8], inflate: 0.25 },
];

const DRAGON_CUBES: readonly CubeSpec[] = [
  { uv: [176, 44], from: [-6, -1, -24], size: [12, 5, 16] },
  { uv: [112, 30], from: [-8, -8, -10], size: [16, 16, 16], mirror: true },
  { uv: [0, 0], from: [-5, -12, -4], size: [2, 4, 6], mirror: true },
  { uv: [112, 0], from: [-5, -3, -22], size: [2, 2, 4] },
  { uv: [0, 0], from: [3, -12, -4], size: [2, 4, 6] },
  { uv: [112, 0], from: [3, -3, -22], size: [2, 2, 4] },
];

const DRAGON_JAW: CubeSpec = { uv: [176, 65], from: [-6, 0, -16], size: [12, 4, 16] };

const PIGLIN_CUBES: readonly CubeSpec[] = [
  { uv: [0, 0], from: [-5, -8, -4], size: [10, 8, 8] },
  { uv: [31, 1], from: [-2, -4, -5], size: [4, 4, 1] },
  { uv: [2, 4], from: [2, -2, -5], size: [1, 2, 1] },
  { uv: [2, 0], from: [-3, -2, -5], size: [1, 2, 1] },
];

const COPPER_POSES: readonly CopperPose[] = ["standing", "running", "sitting", "star"];

/**
 * Adds static Java 26.3 skull/head and copper-golem statue models using only
 * admitted entity PNGs. The returned voxels should be removed from the normal
 * cube fallback only after this function handles them.
 *
 * Skull renderer transforms and Mojang cuboids/UVs are reproduced from the
 * official 26.3 client. Copper statues use their state-selected pose and exact
 * texture/oxidation mapping; pose cuboids below use the corresponding named
 * model layer. These are static snapshots: skull animation, copper animation,
 * owner-profile/custom player skins and BE-only data are intentionally absent.
 */
export function addResourceSpecialFigures(
  root: THREE.Group,
  voxels: readonly BlueprintVoxel[],
  specialTextures: readonly ResourcePackSpecialTexture[],
): Set<BlueprintVoxel> {
  const candidates: Candidate[] = [];
  for (const voxel of voxels) {
    const blockId = voxel.sourceBlockId;
    if (!blockId) continue;
    const skull = SKULL_TEXTURES[blockId];
    if (skull) {
      const wall = blockId.endsWith("_wall_skull") || blockId.endsWith("_wall_head");
      if (wall) {
        const direction = DIRECTIONS[voxel.sourceBlockState?.facing ?? "north"];
        if (!direction) continue;
        candidates.push({
          voxel, figure: skull.model, textureId: skull.textureId,
          position: new THREE.Vector3(
            voxel.x - direction.stepX * 0.25,
            voxel.y - 0.25,
            voxel.z - direction.stepZ * 0.25,
          ),
          yaw: direction.yaw,
        });
      } else {
        const rotation = parseSkullRotation(voxel.sourceBlockState?.rotation);
        if (rotation === undefined) continue;
        candidates.push({
          voxel, figure: skull.model, textureId: skull.textureId,
          position: new THREE.Vector3(voxel.x, voxel.y - 0.5, voxel.z),
          yaw: rotation * Math.PI / 8,
        });
      }
      continue;
    }

    const textureId = COPPER_IDS.find(([id]) => id === blockId)?.[1];
    if (!textureId) continue;
    const pose = parseCopperPose(voxel.sourceBlockState?.pose);
    const facing = DIRECTIONS[voxel.sourceBlockState?.facing ?? "north"];
    if (!pose || !facing) continue;
    candidates.push({
      voxel, figure: `copper-${pose}`, textureId,
      position: new THREE.Vector3(voxel.x, voxel.y - 0.5, voxel.z),
      yaw: facing.yaw,
    });
  }
  if (candidates.length === 0) return new Set();

  const textureById = new Map(specialTextures.map((texture) => [texture.resourceId, texture]));
  const decodedTextures = new Map<string, { texture: THREE.DataTexture; material: THREE.MeshStandardMaterial }>();
  const groups = new Map<string, { figure: FigureType; textureId: string; entries: Candidate[] }>();
  for (const candidate of candidates) {
    if (!textureById.has(candidate.textureId)) continue;
    const key = `${candidate.figure}|${candidate.textureId}`;
    const group = groups.get(key) ?? { figure: candidate.figure, textureId: candidate.textureId, entries: [] };
    group.entries.push(candidate);
    groups.set(key, group);
  }

  const handled = new Set<BlueprintVoxel>();
  const textureOwnerAssigned = new Set<string>();
  for (const [key, group] of groups) {
    const source = textureById.get(group.textureId);
    if (!source) continue;
    let decoded = decodedTextures.get(group.textureId);
    if (!decoded) {
      try {
        const rgba = decodeResourcePackSpecialTexture(source);
        const texture = new THREE.DataTexture(rgba, source.width, source.height, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.name = `blockcolc-${group.textureId}`;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.flipY = true;
        texture.needsUpdate = true;
        const material = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, alphaTest: 0.1, side: THREE.DoubleSide });
        material.name = `blockcolc-${group.textureId}`;
        decoded = { texture, material };
        decodedTextures.set(group.textureId, decoded);
      } catch {
        // Invalid or unsupported PNG: leave every affected block on the normal fallback path.
        continue;
      }
    }

    const definition = figureDefinition(group.figure);
    const geometry = buildFigureGeometry(definition);
    if (geometry.getAttribute("position").count === 0) {
      geometry.dispose();
      continue;
    }
    const mesh = new THREE.InstancedMesh(geometry, decoded.material, group.entries.length);
    mesh.name = `blockcolc-special-figure-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.specialBlockKind = group.figure;
    mesh.userData.specialTextureResourceId = group.textureId;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index]!;
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, entry.yaw);
      matrix.compose(entry.position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      handled.add(entry.voxel);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (!textureOwnerAssigned.has(group.textureId)) {
      mesh.userData.ownedMaterial = decoded.material;
      mesh.userData.ownedTexture = decoded.texture;
      textureOwnerAssigned.add(group.textureId);
    }
    root.add(mesh);
  }
  return handled;
}

function parseSkullRotation(value: string | undefined): number | undefined {
  if (value === undefined) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 15 ? parsed : undefined;
}

function parseCopperPose(value: string | undefined): CopperPose | undefined {
  if (value === undefined) return "standing";
  return COPPER_POSES.includes(value as CopperPose) ? value as CopperPose : undefined;
}

function figureDefinition(figure: FigureType): FigureDefinition {
  if (figure === "skull-mob") return { textureSize: [64, 32], root: { cubes: [SKULL_CUBE] }, skullBasis: true };
  if (figure === "skull-humanoid") return { textureSize: [64, 64], root: { cubes: HUMANOID_HEAD }, skullBasis: true };
  if (figure === "skull-dragon") {
    return {
      textureSize: [256, 256], skullBasis: true,
      root: {
        pivot: [0, -7.986666, 0], scale: [0.75, 0.75, 0.75], cubes: DRAGON_CUBES,
        children: [{ pivot: [0, 4, -8], rotation: [0.2, 0, 0], cubes: [DRAGON_JAW] }],
      },
    };
  }
  if (figure === "skull-piglin") {
    return {
      textureSize: [64, 64], skullBasis: true,
      root: {
        cubes: PIGLIN_CUBES,
        children: [
          { pivot: [4.5, -6, 0], rotation: [0, 0, -0.7], cubes: [{ uv: [51, 6], from: [0, 0, -2], size: [1, 5, 4] }] },
          { pivot: [-4.5, -6, 0], rotation: [0, 0, 0.7], cubes: [{ uv: [39, 6], from: [-1, 0, -2], size: [1, 5, 4] }] },
        ],
      },
    };
  }
  const pose = figure.slice("copper-".length) as CopperPose;
  return { textureSize: [64, 64], root: copperPoseModel(pose), skullBasis: false };
}

function copperPoseModel(pose: CopperPose): PartSpec {
  const copperCube = (uv: Vec2, from: Vec3, size: Vec3, inflate = 0): CubeSpec => ({ uv, from, size, inflate });
  const rootPose = { rotation: [0, 0, Math.PI] as Vec3 };
  const headCubes: CubeSpec[] = [
    copperCube([0, 0], [-4, -5, -5], [8, 5, 10], pose === "standing" ? 0.015 : 0),
    copperCube([56, 0], [-1, -2, -6], [2, 3, 2]),
    copperCube([37, 8], [-1, -9, -1], [2, 4, 2], -0.015),
    copperCube([37, 0], [-2, -13, -2], [4, 4, 4], -0.015),
  ];
  const standardHead: PartSpec = { pivot: [0, -6, 0], cubes: headCubes };
  const standardBody: CubeSpec = copperCube([0, 15], [-4, -6, -3], [8, 6, 6]);
  const bodyChildren: PartSpec[] = [];
  const legs: PartSpec[] = [];
  let bodyPivot: Vec3 = [0, -5, 0];
  let bodyCubes: CubeSpec[] = [standardBody];

  if (pose === "running") {
    bodyPivot = [-1.064, -5, 0];
    bodyCubes = [];
    bodyChildren.push({
      pivot: [1.1, 0.1, 0.7], rotation: [0.1204, -0.0064, -0.0779],
      cubes: [copperCube([0, 15], [-4.02, -6.116, -3.5], [8, 6, 6])],
    });
    bodyChildren.push({
      pivot: [0.7, -5.6, -1.8],
      cubes: [
        copperCube([0, 0], [-4, -5.1, -5], [8, 5, 10]),
        copperCube([56, 0], [-1.02, -2.1, -6], [2, 3, 2]),
        copperCube([37, 8], [-1.02, -9.1, -1], [2, 4, 2], -0.015),
        copperCube([37, 0], [-2, -13.1, -2], [4, 4, 4], -0.015),
      ],
    });
    bodyChildren.push({ pivot: [-4, -6, 0], children: [{
      pivot: [0.7, -0.248, -1.62], rotation: [1.0036, 0, 0],
      cubes: [copperCube([36, 16], [-3.052, -1.11, -2.036], [3, 10, 4])],
    }] });
    bodyChildren.push({ pivot: [4, -6, 0], children: [{
      pivot: [0.732, 0, 0], rotation: [-0.8715, -0.0535, -0.0449],
      cubes: [copperCube([50, 16], [0.032, -1.1, -2], [3, 10, 4])],
    }] });
    legs.push({ pivot: [-3.064, -5, 0], children: [{
      pivot: [1.048, 0, -0.9], rotation: [-0.8727, 0, 0],
      cubes: [copperCube([0, 27], [-1.856, -0.1, -1.09], [4, 5, 4])],
    }] });
    legs.push({ pivot: [0.936, -5, 0], children: [{
      pivot: [1, 0, -0.9], rotation: [0.7854, 0, 0],
      cubes: [copperCube([16, 27], [-2.088, -0.1, -2], [4, 5, 4])],
    }] });
  } else if (pose === "sitting") {
    bodyPivot = [0, -3, 2.325];
    bodyCubes = [
      copperCube([3, 19], [-3, -4, -4.525], [6, 1, 6]),
      copperCube([0, 15], [-4, -3, -3.525], [8, 6, 6]),
    ];
    bodyChildren.push({
      pivot: [0, -1, -4.325], rotation: [0, 0, -3.1416],
      cubes: [copperCube([3, 18], [-4, -3, -2.2], [8, 6, 3])],
    });
    bodyChildren.push({
      pivot: [0, -6, -0.2],
      cubes: [
        copperCube([37, 8], [-1, -7, -3.3], [2, 4, 2], -0.015),
        copperCube([37, 0], [-2, -11, -4.3], [4, 4, 4], -0.015),
        copperCube([0, 0], [-4, -3, -7.325], [8, 5, 10]),
        copperCube([56, 0], [-1, 0, -8.325], [2, 3, 2]),
      ],
    });
    bodyChildren.push({ pivot: [-4, -5.6, -1.8], rotation: [0.4363, 0, 0], children: [{
      pivot: [0, 0.0893, 0.1198], rotation: [-1.0472, 0, 0],
      cubes: [copperCube([36, 16], [-3.075, -0.9733, -1.9966], [3, 10, 4])],
    }] });
    bodyChildren.push({ pivot: [4, -5.6, -1.7], rotation: [0.4363, 0, 0], children: [{
      pivot: [0, -0.0015, -0.0808], rotation: [-1.0472, 0, 0],
      cubes: [copperCube([50, 16], [0.075, -1.0443, -1.8997], [3, 10, 4])],
    }] });
    legs.push({ pivot: [-2.1, -2.1, -2.075], children: [{
      pivot: [0.05, -1.9, 1.075], rotation: [-1.5708, 0, 0],
      cubes: [copperCube([0, 27], [-2, 0.975, 0], [4, 5, 4])],
    }] });
    legs.push({ pivot: [2, -2, -2.075], children: [{
      pivot: [0.05, -2, 1.075], rotation: [-1.5708, 0, 0],
      cubes: [copperCube([16, 27], [-2, 0.975, 0], [4, 5, 4])],
    }] });
  } else if (pose === "star") {
    bodyChildren.push(standardHead);
    bodyChildren.push({ pivot: [-4, -6, 0], children: [{
      pivot: [1, 1, 0], rotation: [0, 0, 1.9199],
      cubes: [copperCube([36, 16], [-1.5, -5, -2], [3, 10, 4])],
    }] });
    bodyChildren.push({ pivot: [4, -6, 0], children: [{
      pivot: [-1, 1, 0], rotation: [0, 0, -1.9199],
      cubes: [copperCube([50, 16], [-1.5, -5, -2], [3, 10, 4])],
    }] });
    legs.push({ pivot: [-3, -5, 0], children: [{
      pivot: [0.35, 2, 0.01], rotation: [0, 0, 0.2618],
      cubes: [copperCube([0, 27], [-2, -2.5, -2], [4, 5, 4])],
    }] });
    legs.push({ pivot: [1, -5, 0], children: [{
      pivot: [1.65, 2, 0], rotation: [0, 0, -0.2618],
      cubes: [copperCube([16, 27], [-2, -2.5, -2], [4, 5, 4])],
    }] });
  } else {
    bodyChildren.push(standardHead);
    bodyChildren.push({ pivot: [-4, -6, 0], cubes: [copperCube([36, 16], [-3, -1, -2], [3, 10, 4])] });
    bodyChildren.push({ pivot: [4, -6, 0], cubes: [copperCube([50, 16], [0, -1, -2], [3, 10, 4])] });
    legs.push({ pivot: [0, -5, 0], cubes: [copperCube([0, 27], [-4, 0, -2], [4, 5, 4])] });
    legs.push({ pivot: [0, -5, 0], cubes: [copperCube([16, 27], [0, 0, -2], [4, 5, 4])] });
  }

  const body: PartSpec = { pivot: bodyPivot, cubes: bodyCubes, children: bodyChildren };
  return { ...rootPose, children: [body, ...legs] };
}

function buildFigureGeometry(definition: FigureDefinition): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  appendPart(definition.root, new THREE.Matrix4(), definition, positions, uvs, indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendPart(
  part: PartSpec,
  parent: THREE.Matrix4,
  definition: FigureDefinition,
  positions: number[],
  uvs: number[],
  indices: number[],
): void {
  const local = partMatrix(part);
  const transform = parent.clone().multiply(local);
  for (const cube of part.cubes ?? []) appendCube(cube, transform, definition, positions, uvs, indices);
  for (const child of part.children ?? []) appendPart(child, transform, definition, positions, uvs, indices);
}

function partMatrix(part: PartSpec): THREE.Matrix4 {
  const [px, py, pz] = part.pivot ?? [0, 0, 0];
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
  const [sx, sy, sz] = part.scale ?? [1, 1, 1];
  const rxMatrix = new THREE.Matrix4().makeRotationX(rx);
  const ryMatrix = new THREE.Matrix4().makeRotationY(ry);
  const rzMatrix = new THREE.Matrix4().makeRotationZ(rz);
  return new THREE.Matrix4().makeTranslation(px, py, pz)
    .multiply(rzMatrix).multiply(ryMatrix).multiply(rxMatrix)
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
}

function appendCube(
  cube: CubeSpec,
  modelTransform: THREE.Matrix4,
  definition: FigureDefinition,
  positions: number[],
  uvs: number[],
  indices: number[],
): void {
  const grow = cube.inflate ?? 0;
  let [x0, y0, z0] = cube.from;
  let [width, height, depth] = cube.size;
  x0 -= grow; y0 -= grow; z0 -= grow;
  width += grow * 2; height += grow * 2; depth += grow * 2;
  let x1 = x0 + width;
  if (cube.mirror) [x0, x1] = [x1, x0];
  const y1 = y0 + height;
  const z1 = z0 + depth;
  const [u, v] = cube.uv;
  const [textureWidth, textureHeight] = definition.textureSize;
  const eastU = u + depth + width;
  const eastEnd = eastU + depth;
  const southU = eastEnd;
  const southV = v + depth + height;
  const faces: readonly (readonly [readonly Vec3[], readonly Vec2[]])[] = [
    // Vertex/UV order below follows ModelPart.Cube and its 26.3 UV rectangles.
    [[[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], [[u + depth + width, v], [u + depth, v], [u + depth, v + depth], [u + depth + width, v + depth]]],
    [[[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [[u + depth + width + width, v + depth], [u + depth + width, v + depth], [u + depth + width, v], [u + depth + width + width, v]]],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[u + depth, v + depth], [u, v + depth], [u, v + depth + height], [u + depth, v + depth + height]]],
    [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[u + depth + width, v + depth], [u + depth, v + depth], [u + depth, v + depth + height], [u + depth + width, v + depth + height]]],
    [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[eastEnd, v + depth], [eastU, v + depth], [eastU, v + depth + height], [eastEnd, v + depth + height]]],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[southU + width, v + depth], [southU, v + depth], [southU, southV], [southU + width, southV]]],
  ];
  for (const [facePositions, faceUvs] of faces) {
    const start = positions.length / 3;
    for (let index = 0; index < 4; index += 1) {
      const [px, py, pz] = facePositions[cube.mirror ? 3 - index : index]!;
      const point = new THREE.Vector3(px, py, pz).applyMatrix4(modelTransform);
      if (definition.skullBasis) point.set(-point.x, -point.y, point.z);
      positions.push(point.x / 16, point.y / 16, point.z / 16);
      const [tu, tv] = faceUvs[cube.mirror ? 3 - index : index]!;
      uvs.push(tu / textureWidth, 1 - tv / textureHeight);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}
