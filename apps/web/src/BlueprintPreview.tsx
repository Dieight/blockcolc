import { useCallback, useEffect, useRef } from 'react';
import type { BlueprintV1, VoxelRenderer, WorldSnapshot } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { RotateCcw } from 'lucide-react';
import { loadVoxelModule, resourcePackAtlasMaximumSizeForTest } from './voxel-runtime';
import { resolveSelectedResourcePack } from './resource-pack-selection';

/**
 * The small renderer used by both project creation and the saved blueprint
 * library. Keeping the source contract at the preview boundary means an
 * imported library candidate does not need to masquerade as a domain project
 * just to receive the same camera, terrain and weather treatment.
 */
export interface BlueprintPreviewSource {
  id: string;
  displayName: string;
  blueprint: BlueprintV1;
}

export interface BlueprintPreviewProps {
  resourcePacks: ResourcePackRepository;
  source: BlueprintPreviewSource;
  className?: string;
  showHud?: boolean;
}

export function BlueprintPreview({
  resourcePacks,
  source,
  className = '',
  showHud = true,
}: BlueprintPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VoxelRenderer | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const previewSnapshot = useCallback((entry: BlueprintPreviewSource): WorldSnapshot => ({
    projectId: 'blueprint-preview',
    blueprintId: entry.id,
    buildingCompletionBasisPoints: 10_000,
    buildingConditionBasisPoints: 10_000,
    isMonument: false,
    settlementIndex: 0,
  }), []);

  useEffect(() => {
    let cancelled = false;
    let current: VoxelRenderer | null = null;
    void loadVoxelModule().then(async ({ createVoxelRenderer, resolveBuiltinBlueprint }) => {
      if (cancelled || !canvasRef.current) return;
      current = createVoxelRenderer(canvasRef.current, {
        previewMode: true,
        resolveBlueprint: id => sourceRef.current.id === id
          ? sourceRef.current.blueprint
          : resolveBuiltinBlueprint(id),
        resourcePackAtlasMaximumSize: resourcePackAtlasMaximumSizeForTest(),
      });
      rendererRef.current = current;
      current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);
      current.setWorld(previewSnapshot(sourceRef.current));
      const pack = await resolveSelectedResourcePack(resourcePacks);
      if (!cancelled && current) {
        await current.setResourcePack(pack ? { id: pack.id, manifest: pack.manifest } : null);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      current?.dispose();
      if (rendererRef.current === current) rendererRef.current = null;
    };
  }, [previewSnapshot, resourcePacks]);

  useEffect(() => {
    rendererRef.current?.setWorld(previewSnapshot(source));
  }, [previewSnapshot, source]);

  return (
    <div className={`blueprint-preview${className ? ` ${className}` : ''}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${source.displayName}完整建筑预览，可拖动旋转`}
        data-preview-blueprint-id={source.id}
      />
      {showHud && (
        <div className="world-hud preview-hud">
          <span>{source.displayName}</span>
          <button
            type="button"
            title="重置预览视角"
            aria-label="重置预览视角"
            onClick={() => rendererRef.current?.resetCamera()}
          >
            <RotateCcw />
          </button>
        </div>
      )}
    </div>
  );
}
