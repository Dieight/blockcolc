import type { ConstructionOutlineVisibility, VoxelLightingQuality } from '@tomato-clock/voxel';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface FocusPreferences {
  focusMinutes: number;
  habitFocusMinutes: number;
  habitTargetRounds: number;
  breakMinutes: number;
  lightingQuality: VoxelLightingQuality;
  constructionOutlineVisibility: ConstructionOutlineVisibility;
  showWorldCoordinates: boolean;
  /** 0 is fully tinted; 100 is the clearest supported glass treatment. */
  focusGlassTransparency: number;
  themeMode: ThemeMode;
}
