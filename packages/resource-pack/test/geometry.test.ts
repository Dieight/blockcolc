import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseJava16xResourcePack, resolveBlockGeometry, resolveBlockTextures } from "../src";

describe("axis-aligned block geometry", () => {
  it("parses partial cuboids and resolves quarter-turn coordinates, faces and cull hints", () => {
    const manifest = pack({
      "assets/test/blockstates/rotated.json": json({ variants: { "": { model: "test:block/shape", y: 90 } } }),
      "assets/test/models/block/shape.json": json({
        textures: { all: "test:block/stone" },
        elements: [{
          from: [0, 0, 0],
          to: [8, 4, 16],
          shade: false,
          faces: {
            north: { texture: "#all", cullface: "north" },
            up: { texture: "#all" },
          },
        }],
      }),
      "assets/test/textures/block/stone.png": png16(),
    });

    expect(manifest.models[0]).toMatchObject({
      elements: [{
        from: [0, 0, 0],
        to: [8, 4, 16],
        shade: false,
        shadeDirectionOverride: "up",
        faces: { north: { cullFace: "north" }, up: { uv: [0, 0, 8, 16] } },
      }],
    });
    const resolved = resolveBlockGeometry(manifest, "test:rotated");
    expect(resolved).toMatchObject({
      status: "resolved_geometry",
      modelId: "test:block/shape",
      elements: [{
        from: [0, 0, 8],
        to: [16, 4, 16],
        shade: false,
        shadeDirectionOverride: "up",
        faces: {
          west: { texture: "test:block/stone", cullFace: "west" },
          up: { texture: "test:block/stone" },
        },
      }],
    });
    expect(resolveBlockTextures(manifest, "test:rotated")).toEqual({
      status: "fallback",
      reason: "COMPLEX_GEOMETRY",
      resourceId: "test:block/shape",
    });
  });

  it("resolves a two-element straight stair without inventing internal faces and keeps bounds independent of uvlock", () => {
    const manifest = pack({
      "assets/test/blockstates/stairs.json": json({ variants: {
        "mode=straight": { model: "test:block/stairs" },
        "mode=locked": { model: "test:block/stairs", x: 180, y: 90, uvlock: true },
        "mode=unlocked": { model: "test:block/stairs", x: 180, y: 90, uvlock: false },
      } }),
      "assets/test/models/block/stairs.json": json({
        textures: { all: "test:block/stone" },
        elements: [
          {
            from: [0, 0, 0], to: [16, 8, 16],
            faces: {
              down: { texture: "#all" }, north: { texture: "#all" }, south: { texture: "#all" },
              west: { texture: "#all" }, east: { texture: "#all" },
            },
          },
          {
            from: [0, 8, 8], to: [16, 16, 16],
            faces: { up: { texture: "#all" }, north: { texture: "#all" }, south: { texture: "#all" } },
          },
        ],
      }),
      "assets/test/textures/block/stone.png": png16(),
    });

    const straight = resolveBlockGeometry(manifest, "test:stairs", { mode: "straight" });
    expect(straight.status).toBe("resolved_geometry");
    if (straight.status !== "resolved_geometry") return;
    expect(straight.elements).toHaveLength(2);
    expect(Object.keys(straight.elements[0]!.faces)).toHaveLength(5);
    expect(straight.elements[0]!.faces.up).toBeUndefined();
    expect(Object.keys(straight.elements[1]!.faces)).toHaveLength(3);

    const locked = resolveBlockGeometry(manifest, "test:stairs", { mode: "locked" });
    const unlocked = resolveBlockGeometry(manifest, "test:stairs", { mode: "unlocked" });
    expect(locked.status).toBe("resolved_geometry");
    expect(unlocked.status).toBe("resolved_geometry");
    if (locked.status === "resolved_geometry" && unlocked.status === "resolved_geometry") {
      expect(locked.elements.map(({ from, to }) => ({ from, to }))).toEqual(
        unlocked.elements.map(({ from, to }) => ({ from, to })),
      );
    }
  });

  it("inherits parent elements only when a child does not define its own", () => {
    const manifest = pack({
      "assets/test/blockstates/inherited.json": json({ variants: { "": { model: "test:block/inherited" } } }),
      "assets/test/blockstates/replaced.json": json({ variants: { "": { model: "test:block/replaced" } } }),
      "assets/test/models/block/base.json": json({
        textures: { all: "test:block/base" },
        elements: [box([0, 0, 0], [16, 8, 16], "#all")],
      }),
      "assets/test/models/block/inherited.json": json({ parent: "test:block/base", textures: { all: "test:block/child" } }),
      "assets/test/models/block/replaced.json": json({
        parent: "test:block/base",
        textures: { all: "test:block/child" },
        elements: [box([0, 12, 0], [16, 16, 16], "#all")],
      }),
      "assets/test/textures/block/base.png": png16(),
      "assets/test/textures/block/child.png": png16(),
    });

    expect(resolveBlockGeometry(manifest, "test:inherited")).toMatchObject({
      status: "resolved_geometry",
      elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { north: { texture: "test:block/child" } } }],
    });
    expect(resolveBlockGeometry(manifest, "test:replaced")).toMatchObject({
      status: "resolved_geometry",
      elements: [{ from: [0, 12, 0], to: [16, 16, 16], faces: { north: { texture: "test:block/child" } } }],
    });
    const replaced = resolveBlockGeometry(manifest, "test:replaced");
    expect(replaced.status === "resolved_geometry" ? replaced.elements : []).toHaveLength(1);
  });

  it("accepts bounded element rotation and extended coordinates, while rejecting hostile bounds", () => {
    const tooMany = Array.from({ length: 65 }, () => box([0, 0, 0], [1, 1, 1], "#all"));
    const manifest = pack({
      "assets/test/models/block/rotated.json": json({
        textures: { all: "test:block/stone" },
        elements: [{ ...box([0, 0, 0], [16, 16, 16], "#all"), rotation: { origin: [8, 8, 8], axis: "y", angle: 45 } }],
      }),
      "assets/test/models/block/too_many.json": json({ textures: { all: "test:block/stone" }, elements: tooMany }),
      "assets/test/models/block/outside.json": json({ textures: { all: "test:block/stone" }, elements: [box([-1, 0, 0], [16, 16, 16], "#all")] }),
      "assets/test/models/block/too_far.json": json({ textures: { all: "test:block/stone" }, elements: [box([-17, 0, 0], [16, 16, 16], "#all")] }),
      "assets/test/models/block/vanilla_external_rotation_origin.json": json({
        textures: { all: "test:block/stone" },
        elements: [{ ...box([3, 14.5, 3], [13, 14.5, 13], "#all"), rotation: { origin: [11, 35, 11], axis: "y", angle: 0 } }],
      }),
      "assets/test/models/block/too_far_origin.json": json({
        textures: { all: "test:block/stone" },
        elements: [{ ...box([0, 0, 0], [16, 16, 16], "#all"), rotation: { origin: [8, 49, 8], axis: "y", angle: 45 } }],
      }),
      "assets/test/models/block/non_finite_origin.json": json({
        textures: { all: "test:block/stone" },
        elements: [{ ...box([0, 0, 0], [16, 16, 16], "#all"), rotation: { origin: [8, null, 8], axis: "y", angle: 45 } }],
      }),
      "assets/test/textures/block/stone.png": png16(),
    });

    expect(manifest.models.find((model) => model.resourceId === "test:block/rotated")).toMatchObject({
      elements: [{ rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: false } }],
    });
    expect(manifest.models.some((model) => model.resourceId === "test:block/too_many")).toBe(false);
    expect(manifest.models.find((model) => model.resourceId === "test:block/outside")).toMatchObject({
      elements: [{ from: [-1, 0, 0] }],
    });
    expect(manifest.models.some((model) => model.resourceId === "test:block/too_far")).toBe(false);
    expect(manifest.models.find((model) => model.resourceId === "test:block/vanilla_external_rotation_origin")).toMatchObject({
      elements: [{ rotation: { origin: [11, 35, 11] } }],
    });
    expect(manifest.models.some((model) => model.resourceId === "test:block/too_far_origin")).toBe(false);
    expect(manifest.models.some((model) => model.resourceId === "test:block/non_finite_origin")).toBe(false);
    expect(manifest.summary.issues.filter((issue) => issue.code === "INVALID_MODEL_JSON")).toHaveLength(4);
  });

  it("preserves reversed 26.3 inner-face bounds and explicit shade directions", () => {
    const manifest = pack({
      "assets/test/blockstates/inner.json": json({ variants: { "": { model: "test:block/inner" } } }),
      "assets/test/models/block/inner.json": json({
        textures: { all: "test:block/stone" },
        elements: [{
          from: [15.998, 0, 0],
          to: [0.002, 16, 16],
          shade_direction_override: "north",
          faces: { north: { texture: "#all" } },
        }],
      }),
      "assets/test/blockstates/invalid_direction.json": json({ variants: { "": { model: "test:block/invalid_direction" } } }),
      "assets/test/models/block/invalid_direction.json": json({
        textures: { all: "test:block/stone" },
        elements: [{ ...box([0, 0, 0], [16, 16, 16], "#all"), shade_direction_override: "diagonal" }],
      }),
      "assets/test/models/block/non_finite.json": json({
        textures: { all: "test:block/stone" },
        elements: [{ ...box([0, 0, 0], [16, 16, 16], "#all"), from: [0, null, 0] }],
      }),
      "assets/test/blockstates/lichen_plane.json": json({ variants: { "": { model: "test:block/lichen_plane" } } }),
      "assets/test/models/block/lichen_plane.json": json({
        textures: { all: "test:block/stone" },
        elements: [{
          from: [0, 0, 0.1],
          to: [16, 16, 0.1],
          faces: {
            north: { texture: "#all" },
            south: { texture: "#all" },
            west: { texture: "#all" },
          },
        }],
      }),
      "assets/test/textures/block/stone.png": png16(),
    });
    const inner = manifest.models.find((model) => model.resourceId === "test:block/inner");
    expect(inner?.elements?.[0]).toMatchObject({
      from: [15.998, 0, 0],
      to: [0.002, 16, 16],
      shadeDirectionOverride: "north",
    });
    expect(resolveBlockGeometry(manifest, "test:inner")).toMatchObject({
      status: "resolved_geometry",
      elements: [{ from: [15.998, 0, 0], to: [0.002, 16, 16], shadeDirectionOverride: "north" }],
    });
    expect(resolveBlockGeometry(manifest, "test:lichen_plane")).toMatchObject({
      status: "resolved_geometry",
      elements: [{ faces: { north: {}, south: {}, west: {} } }],
    });
    expect(manifest.models.some((model) => model.resourceId === "test:block/invalid_direction")).toBe(false);
    expect(manifest.models.some((model) => model.resourceId === "test:block/non_finite")).toBe(false);
    expect(manifest.summary.issues.filter((issue) => issue.code === "INVALID_MODEL_JSON")).toHaveLength(2);
  });

  it("keeps the 26.3 vault's reversed inner cage in model space for every facing rotation", () => {
    const manifest = pack({
      "assets/minecraft/blockstates/vault.json": json({ variants: {
        "facing=north": { model: "minecraft:block/vault" },
        "facing=east": { model: "minecraft:block/vault", y: 90 },
        "facing=south": { model: "minecraft:block/vault", y: 180 },
        "facing=west": { model: "minecraft:block/vault", y: 270 },
        "facing=up": { model: "minecraft:block/vault", y: 90, uvlock: true },
      } }),
      "assets/minecraft/models/block/vault.json": json({
        parent: "minecraft:block/template_vault",
        textures: { all: "minecraft:block/vault" },
      }),
      "assets/minecraft/models/block/template_vault.json": json({
        textures: { all: "minecraft:block/vault" },
        elements: [{
          from: [15.998, 3.002, 0.002],
          to: [0.002, 15.998, 15.998],
          faces: Object.fromEntries(["north", "east", "south", "west", "up", "down"].map((face) => [face, {
            texture: "#all", uv: [16, 0, 0, 13],
          }])),
        }],
      }),
      "assets/minecraft/textures/block/vault.png": png16(),
    });
    const bounds = { from: [15.998, 3.002, 0.002], to: [0.002, 15.998, 15.998] };

    for (const [facing, y] of [["east", 90], ["south", 180], ["west", 270]] as const) {
      const resolved = resolveBlockGeometry(manifest, "minecraft:vault", { facing });
      expect(resolved.status).toBe("resolved_geometry");
      if (resolved.status !== "resolved_geometry") continue;
      expect(resolved.elements[0]).toMatchObject({
        ...bounds,
        blockRotation: { x: 0, y },
        faces: { north: { texture: "minecraft:block/vault", uv: [16, 0, 0, 13] } },
      });
    }
    expect(resolveBlockGeometry(manifest, "minecraft:vault", { facing: "up" })).toMatchObject({
      status: "resolved_geometry",
      elements: [{ blockRotation: { x: 0, y: 90 }, faces: { up: { rotation: 90 } } }],
    });
  });

  it("falls back atomically when any geometry face cannot resolve its texture", () => {
    const manifest = pack({
      "assets/test/blockstates/broken.json": json({ variants: { "": { model: "test:block/broken" } } }),
      "assets/test/models/block/broken.json": json({
        textures: { present: "test:block/stone" },
        elements: [{
          from: [0, 0, 0], to: [16, 8, 16],
          faces: { north: { texture: "#present" }, south: { texture: "#missing" } },
        }],
      }),
      "assets/test/textures/block/stone.png": png16(),
    });

    expect(resolveBlockGeometry(manifest, "test:broken")).toEqual({
      status: "fallback",
      reason: "MISSING_TEXTURE_VARIABLE",
      resourceId: "test:block/broken",
    });
  });

  it("supports 26.2 sign angles and bare same-model texture variables", () => {
    const manifest = pack({
      "assets/test/blockstates/sign.json": json({ variants: { "": { model: "test:block/sign" } } }),
      "assets/test/models/block/sign.json": json({
        textures: { all: "test:block/wood" },
        elements: [{
          from: [0, 9.33333, 7.33333], to: [16, 17.33333, 8.66667],
          rotation: { origin: [8, 0, 8], axis: "y", angle: -67.5 },
          faces: { north: { texture: "all" } },
        }, {
          from: [2.96447, 11, 11.53553], to: [5.96447, 15, 11.53553],
          rotation: { origin: [8, 0, 8], x: 180, y: -67.5, z: -180 },
          faces: { north: { texture: "all" }, south: { texture: "all" } },
        }],
      }),
      "assets/test/textures/block/wood.png": png16(),
    });

    expect(resolveBlockGeometry(manifest, "test:sign")).toMatchObject({
      status: "resolved_geometry",
      elements: [{
        rotation: { origin: [8, 0, 8], axis: "y", angle: -67.5, rescale: false },
        faces: { north: { texture: "test:block/wood" } },
      }, {
        rotation: { origin: [8, 0, 8], euler: [180, -67.5, -180], rescale: false },
        faces: { north: { texture: "test:block/wood" }, south: { texture: "test:block/wood" } },
      }],
    });
  });
});

function pack(files: Record<string, Uint8Array>) {
  return parseJava16xResourcePack(zipSync({
    "pack.mcmeta": json({ pack: { pack_format: 34, description: "geometry test" } }),
    ...files,
  }));
}

function box(from: readonly number[], to: readonly number[], texture: string) {
  return {
    from,
    to,
    faces: {
      down: { texture }, up: { texture }, north: { texture },
      south: { texture }, west: { texture }, east: { texture },
    },
  };
}

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function png16(): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 16, false);
  view.setUint32(4, 16, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(signature, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array([0])), chunk("IEND", new Uint8Array()));
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat(typeBytes, data)), false);
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}
