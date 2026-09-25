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
  /** Local reminder for returning to the next round after a marathon/minimal break. */
  returnToFocusReminders: boolean;
  /** Explicitly authorize the next planned round to start at the break deadline. */
  autoContinueFocus: boolean;
  /** Opt-in real weather on Android; credentials are packaged in the native build. */
  realWeatherEnabled: boolean;
  /** Local launch preference; leaving the minimal view does not clear it. */
  minimalMode?: boolean;
}
