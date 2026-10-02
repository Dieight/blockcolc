import { describe, expect, it, vi } from "vitest";
import { LitematicParseError, parseLitematic, readPackedIndex } from "../src/index";
import { LOCAL_BUILTIN_SOURCES } from "@blockcolc/voxel/local-blueprint-sources";

// Parsing and validation are also used before a world or WebGL context exists.
vi.mock("@blockcolc/voxel", () => { throw new Error("Parser loaded the renderer entry"); });
vi.mock("@blockcolc/voxel/blueprint", () => { throw new Error("Parser loaded the packaged catalog"); });
vi.mock("three", () => { throw new Error("Parser loaded Three"); });

describe("renderer-independent Litematic entry", () => {
  it("reads conversion identities and descriptions without loading packaged assets", () => {
    const sources = Object.entries(LOCAL_BUILTIN_SOURCES);
    expect(sources).toHaveLength(22);
    expect(new Set(sources.map(([, source]) => source.id)).size).toBe(22);
    expect(sources.filter(([, source]) => source.category === "building")).toHaveLength(16);
    expect(sources.filter(([, source]) => source.category === "daily-reward")).toHaveLength(6);
    for (const [file, source] of sources) {
      expect(file).toMatch(/\.litematic$/);
      expect(source.id).toMatch(/^builtin-local-[a-z0-9-]+$/);
      expect(source.description).toMatch(/^.+：.+。$/);
      expect(source.description.match(/。/g)).toHaveLength(1);
    }
  });

  it("decodes packed indices without a renderer or packaged blueprint catalog", () => {
    expect(readPackedIndex([5n], 0, 1)).toBe(1);
    expect(readPackedIndex([5n], 1, 1)).toBe(0);
    expect(readPackedIndex([5n], 2, 1)).toBe(1);
  });

  it("retains the public parse error boundary without optional visual modules", async () => {
    await expect(parseLitematic(new Uint8Array([0, 1, 2, 3])))
      .rejects.toBeInstanceOf(LitematicParseError);
    await expect(parseLitematic(new Uint8Array([0, 1, 2, 3])))
      .rejects.toMatchObject({ code: "NOT_GZIP" });
  });
});
