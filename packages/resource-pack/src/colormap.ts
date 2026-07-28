import { decodePngRgba } from "./png";

export type ResourcePackColormapKind = "grass" | "foliage";

export interface ResourcePackColormap {
  kind: ResourcePackColormapKind;
  resourceId: `minecraft:colormap/${ResourcePackColormapKind}`;
  archivePath: `assets/minecraft/textures/colormap/${ResourcePackColormapKind}.png`;
  width: 256;
  height: 256;
  png: Uint8Array;
}

export interface ResourcePackColormapIssue {
  path: string;
  code: "INVALID_COLORMAP";
  message: string;
}

export interface ParsedResourcePackColormaps {
  colormaps: ResourcePackColormap[];
  issues: ResourcePackColormapIssue[];
  recognizedPaths: string[];
}

const COLORMAP_KINDS = ["grass", "foliage"] as const;

/** Parses only the two vanilla Java colormap override locations. */
export function parseResourcePackColormaps(
  files: Readonly<Record<string, Uint8Array>>,
  archivePaths: readonly string[],
): ParsedResourcePackColormaps {
  const available = new Set(archivePaths);
  const colormaps: ResourcePackColormap[] = [];
  const issues: ResourcePackColormapIssue[] = [];
  const recognizedPaths: string[] = [];
  for (const kind of COLORMAP_KINDS) {
    const archivePath = `assets/minecraft/textures/colormap/${kind}.png` as const;
    if (!available.has(archivePath)) continue;
    recognizedPaths.push(archivePath);
    const png = files[archivePath];
    if (!png) {
      issues.push({ path: archivePath, code: "INVALID_COLORMAP", message: "Colormap was not extracted." });
      continue;
    }
    try {
      decodePngRgba(png, {
        expectedWidth: 256,
        expectedHeight: 256,
        maxPixels: 256 * 256,
        maxDecodedBytes: 256 * 256 * 4,
      });
    } catch (cause) {
      issues.push({
        path: archivePath,
        code: "INVALID_COLORMAP",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }
    colormaps.push({
      kind,
      resourceId: `minecraft:colormap/${kind}`,
      archivePath,
      width: 256,
      height: 256,
      png,
    });
  }
  return { colormaps, issues, recognizedPaths };
}

export function decodeResourcePackColormap(colormap: ResourcePackColormap): Uint8Array {
  return decodePngRgba(colormap.png, {
    expectedWidth: 256,
    expectedHeight: 256,
    maxPixels: 256 * 256,
    maxDecodedBytes: 256 * 256 * 4,
  }).rgba;
}
