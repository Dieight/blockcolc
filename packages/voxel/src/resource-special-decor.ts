import { decodeResourcePackSpecialTexture, type ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";

/** Java 26.3 DyeColor#getTextureDiffuseColor, read from the user's local client JAR. */
const DYE_RGB: Readonly<Record<string, number>> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da,
  yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};

type Part = {
  key: string;
  geometry: THREE.BufferGeometry;
  textureId: string;
  color?: number;
  transparent?: boolean;
  renderOrder?: number;
};

type Batch = { part: Part; voxels: BlueprintVoxel[]; angle: number };

/**
 * Static block-entity forms whose resources live under textures/entity, not
 * block-model JSON. Banner patterns, per-face pot sherds, conduit activation,
 * and conduit orientation/animation require block-entity NBT absent from the
 * current blueprint schema. They are rendered as the vanilla blank/inactive
 * forms, and each mesh records that limitation in userData.
 */
export function addResourceSpecialDecor(
  root: THREE.Group,
  voxels: readonly BlueprintVoxel[],
  specialTextures: readonly ResourcePackSpecialTexture[],
): Set<BlueprintVoxel> {
  const sources = new Map(specialTextures.map((texture) => [texture.resourceId, texture]));
  const textureCache = new Map<string, THREE.DataTexture>();
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const partsCache = new Map<string, Part[]>();
  const batches = new Map<string, Batch>();
  const handled = new Set<BlueprintVoxel>();

  const getTexture = (id: string): THREE.DataTexture | undefined => {
    const cached = textureCache.get(id);
    if (cached) return cached;
    const source = sources.get(id);
    if (!source) return undefined;
    const texture = new THREE.DataTexture(
      decodeResourcePackSpecialTexture(source), source.width, source.height,
      THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    texture.name = `blockcolc-${id}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    textureCache.set(id, texture);
    return texture;
  };

  const add = (voxel: BlueprintVoxel, angle: number, parts: readonly Part[]): boolean => {
    // A missing required asset must not leave a half-built special model.
    if (parts.some((part) => !sources.has(part.textureId))) return false;
    for (const part of parts) {
      const key = `${part.key}|${part.textureId}|${part.color ?? ""}|${angle}`;
      const batch = batches.get(key);
      if (batch) batch.voxels.push(voxel);
      else batches.set(key, { part, voxels: [voxel], angle });
    }
    handled.add(voxel);
    return true;
  };

  for (const voxel of voxels) {
    const id = voxel.sourceBlockId ?? "";
    const banner = /^minecraft:(.+?)(?:_(wall))?_banner$/.exec(id);
    if (banner && DYE_RGB[banner[1] ?? ""] !== undefined) {
      if (!sources.has("minecraft:entity/banner/banner_base") || !sources.has("minecraft:entity/banner/base")) continue;
      const wall = banner[2] === "wall";
      const angle = wall ? bannerFacingAngle(voxel.sourceBlockState?.facing) : standingAngle(voxel.sourceBlockState?.rotation);
      let parts = partsCache.get(id);
      if (!parts) { parts = bannerParts(wall, DYE_RGB[banner[1] ?? ""]!); partsCache.set(id, parts); }
      add(voxel, angle, parts);
    } else if (id === "minecraft:decorated_pot") {
      if (!sources.has("minecraft:entity/decorated_pot/decorated_pot_base") || !sources.has("minecraft:entity/decorated_pot/decorated_pot_side")) continue;
      let parts = partsCache.get(id);
      if (!parts) { parts = potParts(); partsCache.set(id, parts); }
      add(voxel, potFacingAngle(voxel.sourceBlockState?.facing), parts);
    } else if (id === "minecraft:conduit") {
      if (!sources.has("minecraft:entity/conduit/base")) continue;
      let parts = partsCache.get(id);
      if (!parts) { parts = conduitParts(); partsCache.set(id, parts); }
      add(voxel, 0, parts);
    }
  }

  const materialOwner = new Set<THREE.Material>();
  const textureOwner = new Set<THREE.Texture>();
  for (const batch of batches.values()) {
    const texture = getTexture(batch.part.textureId);
    if (!texture) continue;
    const materialKey = `${batch.part.textureId}|${batch.part.color ?? ""}|${batch.part.transparent ?? false}`;
    let material = materialCache.get(materialKey);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        map: texture,
        color: batch.part.color ?? 0xffffff,
        transparent: batch.part.transparent ?? false,
        alphaTest: batch.part.transparent ? 0.01 : 0.5,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0,
      });
      material.name = `blockcolc-${batch.part.key}`;
      materialCache.set(materialKey, material);
    }
    // clearGroup disposes geometry per mesh. Give each batch its own geometry
    // so meshes split by dye/rotation never dispatch duplicate dispose events.
    const mesh = new THREE.InstancedMesh(batch.part.geometry.clone(), material, batch.voxels.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    for (let index = 0; index < batch.voxels.length; index += 1) {
      const voxel = batch.voxels[index]!;
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), batch.angle);
      position.set(voxel.x, voxel.y, voxel.z);
      matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = batch.part.renderOrder ?? 0;
    mesh.userData.specialBlockKind = batch.part.key;
    mesh.userData.blockEntityDataLimitations = limitationFor(batch.part.key);
    if (!materialOwner.has(material)) {
      mesh.userData.ownedMaterial = material;
      materialOwner.add(material);
    }
    if (!textureOwner.has(texture)) {
      mesh.userData.ownedTexture = texture;
      textureOwner.add(texture);
    }
    root.add(mesh);
  }
  return handled;
}

function standingAngle(value: string | undefined): number {
  const rotation = Number(value);
  return Number.isInteger(rotation) && rotation >= 0 && rotation < 16 ? -rotation * Math.PI / 8 : 0;
}

function bannerFacingAngle(value: string | undefined): number {
  // BannerRenderer: -Direction.toYRot(); vanilla's local cloth faces south.
  return { south: 0, west: -Math.PI / 2, north: Math.PI, east: Math.PI / 2 }[value ?? "south"] ?? 0;
}

function potFacingAngle(value: string | undefined): number {
  // DecoratedPotRenderer.createModelTransformation: 180 - Direction.toYRot().
  // North is the model's identity orientation; pot and banner yaw rules differ.
  return { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[value ?? "north"] ?? 0;
}

function limitationFor(partKey: string): string[] {
  if (partKey.startsWith("banner_") || partKey.startsWith("wall_banner_")) {
    return ["Banner pattern layers and their per-layer dyes require block-entity NBT; only the imported plain base color is rendered."];
  }
  if (partKey.startsWith("decorated_pot_")) {
    return ["Four per-face pottery sherd patterns require block-entity NBT; the imported blank side sprite is rendered."];
  }
  if (partKey === "conduit_shell") {
    return ["Activation, cage, eye, wind, and animation state require block-entity NBT; the imported inactive shell is rendered."];
  }
  return [];
}

function bannerParts(wall: boolean, color: number): Part[] {
  const bannerBase = "minecraft:entity/banner/banner_base";
  const dyeBase = "minecraft:entity/banner/base";
  // Java BannerModel/BannerFlagModel cuboids: banner_base is the wooden model
  // and cloth; banner/base is the dye-coloured base pattern on the flag.
  const bannerPoint = (x: number, y: number, z: number): [number, number, number] =>
    [x / 24, -y / 24 - 0.5, -z / 24];
  const flagY = wall ? -20.5 : -44;
  const flagZ = wall ? 8.5 : -2;
  const flag = modelBox(-10, flagY, flagZ, 20, 40, 1, 0, 0, 64, 64, bannerPoint);
  const parts: Part[] = [
    { key: wall ? "wall_banner_bar" : "banner_bar", textureId: bannerBase,
      geometry: modelBox(-10, wall ? -20.5 : -44, wall ? 9.5 : -1, 20, 2, 2, 0, 42, 64, 64, bannerPoint) },
    { key: wall ? "wall_banner_flag" : "banner_flag", textureId: bannerBase, geometry: flag },
    { key: wall ? "wall_banner_dye" : "banner_dye", textureId: dyeBase, color,
      geometry: modelBox(-10, flagY, flagZ - 0.03, 20, 40, 1.06, 0, 0, 64, 64, bannerPoint),
      transparent: true, renderOrder: 3 },
  ];
  if (!wall) parts.unshift({ key: "banner_pole", textureId: bannerBase,
    geometry: modelBox(-1, -42, -1, 2, 42, 2, 44, 0, 64, 64, bannerPoint) });
  return parts;
}

function potParts(): Part[] {
  const base = "minecraft:entity/decorated_pot/decorated_pot_base";
  const side = "minecraft:entity/decorated_pot/decorated_pot_side";
  const modelPoint = (x: number, y: number, z: number): [number, number, number] =>
    [x / 16 - 0.5, y / 16 - 0.5, z / 16 - 0.5];
  const neckPose = new THREE.Matrix4().makeTranslation(0, 37, 16)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI));
  const neckPoint = (x: number, y: number, z: number): [number, number, number] => {
    const point = new THREE.Vector3(x, y, z).applyMatrix4(neckPose);
    return modelPoint(point.x, point.y, point.z);
  };
  const sides = potSideParts(side);
  return [
    ...sides,
    // DecoratedPotRenderer.createBaseLayer(): two neck cuboids, with their
    // LayerDefinition CubeDeformation values and parent pose applied.
    { key: "decorated_pot_neck", textureId: base,
      geometry: modelBox(4.1, 17.1, 4.1, 7.8, 2.8, 7.8, 0, 0, 32, 32, neckPoint) },
    { key: "decorated_pot_neck_lip", textureId: base,
      geometry: modelBox(4.8, 19.8, 4.8, 6.4, 1.4, 6.4, 0, 5, 32, 32, neckPoint) },
    // Mojang's top/bottom are planes (texOffs(-14, 13), 14x0x14), not a
    // thick rim or a solid body. The sprites use distinct 14x14 UV regions.
    { key: "decorated_pot_top", textureId: base,
      geometry: potHorizontalFace(true, modelPoint) },
    { key: "decorated_pot_bottom", textureId: base,
      geometry: potHorizontalFace(false, modelPoint) },
  ];
}

function potSideParts(textureId: string): Part[] {
  // Exact DecoratedPotRenderer.createSidesLayer() part poses from Java 26.3.
  // The base box emits only its NORTH quad; the four poses place that quad on
  // the sides and preserve the official 1..15 by 0..16 sprite crop.
  const faces = [
    { key: "decorated_pot_front", offset: [1, 16, 15] as const, rotation: [Math.PI, 0, 0] as const },
    { key: "decorated_pot_back", offset: [15, 16, 1] as const, rotation: [0, 0, Math.PI] as const },
    { key: "decorated_pot_left", offset: [1, 16, 1] as const, rotation: [0, -Math.PI / 2, Math.PI] as const },
    { key: "decorated_pot_right", offset: [15, 16, 15] as const, rotation: [0, Math.PI / 2, Math.PI] as const },
  ];
  return faces.map(({ key, offset, rotation }) => {
    const [x, y, z] = offset;
    const [rx, ry, rz] = rotation;
    const pose = new THREE.Matrix4().makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeRotationZ(rz))
      .multiply(new THREE.Matrix4().makeRotationY(ry))
      .multiply(new THREE.Matrix4().makeRotationX(rx));
    const transform = (px: number, py: number, pz: number): [number, number, number] => {
      const point = new THREE.Vector3(px, py, pz).applyMatrix4(pose);
      return [point.x / 16 - 0.5, point.y / 16 - 0.5, point.z / 16 - 0.5];
    };
    return {
      key, textureId,
      geometry: modelFace(
        [[14, 0, 0], [0, 0, 0], [0, 16, 0], [14, 16, 0]],
        [[15, 0], [1, 0], [1, 16], [15, 16]],
        16, 16, transform,
      ),
    };
  });
}

function potHorizontalFace(
  top: boolean,
  transform: (x: number, y: number, z: number) => [number, number, number],
): THREE.BufferGeometry {
  const y = top ? 16 : 0;
  const corners: readonly [number, number, number][] = top
    ? [[15, y, 1], [1, y, 1], [1, y, 15], [15, y, 15]]
    : [[15, y, 15], [1, y, 15], [1, y, 1], [15, y, 1]];
  const uvs: readonly [number, number][] = top
    ? [[28, 27], [14, 27], [14, 13], [28, 13]]
    : [[14, 13], [0, 13], [0, 27], [14, 27]];
  return modelFace(corners, uvs, 32, 32, transform);
}

function modelFace(
  points: readonly [number, number, number][],
  uvs: readonly [number, number][],
  textureWidth: number,
  textureHeight: number,
  transform: (x: number, y: number, z: number) => [number, number, number],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const mappedUvs: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    positions.push(...transform(...points[index]!));
    const [u, v] = uvs[index]!;
    mappedUvs.push(u / textureWidth, 1 - v / textureHeight);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(mappedUvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function conduitParts(): Part[] {
  const point = (x: number, y: number, z: number): [number, number, number] =>
    [x / 16, -y / 16, -z / 16];
  return [{ key: "conduit_shell", textureId: "minecraft:entity/conduit/base",
    geometry: modelBox(-3, -3, -3, 6, 6, 6, 0, 0, 32, 16, point) }];
}

function modelBox(
  x: number, y: number, z: number, width: number, height: number, depth: number,
  textureU: number, textureV: number, textureWidth: number, textureHeight: number,
  transform: (x: number, y: number, z: number) => [number, number, number],
): THREE.BufferGeometry {
  const vertices = [
    [x, y, z], [x + width, y, z], [x + width, y + height, z], [x, y + height, z],
    [x, y, z + depth], [x + width, y, z + depth],
    [x + width, y + height, z + depth], [x, y + height, z + depth],
  ] as const;
  const u0 = textureU, u1 = u0 + depth, u2 = u1 + width, u3 = u2 + width, u4 = u3 + depth, u5 = u4 + width;
  const v0 = textureV, v1 = v0 + depth, v2 = v1 + height;
  const faces: Array<[number[], number, number, number, number]> = [
    [[5, 4, 0, 1], u1, v0, u2, v1], [[2, 3, 7, 6], u2, v1, u3, v0],
    [[0, 4, 7, 3], u0, v1, u1, v2], [[1, 0, 3, 2], u1, v1, u2, v2],
    [[5, 1, 2, 6], u3, v1, u4, v2], [[4, 5, 6, 7], u4, v1, u5, v2],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [indices, startU, startV, endU, endV] of faces) {
    const corners = [
      [endU, startV], [startU, startV], [startU, endV], [endU, endV],
    ];
    for (const corner of [0, 1, 2, 0, 2, 3]) {
      const vertex = vertices[indices[corner]!]!;
      positions.push(...transform(vertex[0], vertex[1], vertex[2]));
      const uv = corners[corner]!;
      uvs.push(uv[0]! / textureWidth, 1 - uv[1]! / textureHeight);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}
