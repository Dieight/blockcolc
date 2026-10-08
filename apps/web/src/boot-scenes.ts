export const BOOT_SCENES = ['house', 'tomato'] as const;
export type BootSceneKind = typeof BOOT_SCENES[number];
export function bootSceneFromSample(sample:number):BootSceneKind {
  return Number.isFinite(sample)&&sample>=.5?'tomato':'house';
}
// Select once, outside render: changing preparation captions never restarts the scene.
export const LAUNCH_BOOT_SCENE = bootSceneFromSample(Math.random());
