export const desktopOnlySpecs = /(?:responsive-qa|v2-world-interaction|v11-world-environment)\.spec\.ts/;

export const crossViewportRendererSpecs = /(?:building-memory|v3-lightweight-shading|v15-lighting-quality|settings-layout)\.spec\.ts/;

// These files answer one-off visual or runtime questions. They remain available
// through the diagnostic command, but they are not stable product regressions.
// New probes should use the `*.diagnostic.spec.ts` suffix so they are excluded
// without extending this legacy-name list.
export const diagnosticSpecs = /(?:\.diagnostic|cine-probe|flat-probe|fog-diag|normal-probe|pack-measure|pick-diag|v21-right-band-probe|v24-load-diag|v24-voidscan|void-probe)\.spec\.ts/;
