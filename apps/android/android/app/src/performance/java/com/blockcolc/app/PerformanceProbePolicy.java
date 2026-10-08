package com.blockcolc.app;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Diagnostic transport accepts a small numeric schema, never arbitrary JS or text. */
final class PerformanceProbePolicy {
    static final long MAX_RUN_MS = 240_000L;
    static final int MAX_PAYLOAD_CHARS = 24_000;
    static final Set<String> WINDOWS = new HashSet<>(Arrays.asList("startup", "idle", "rotation-first", "rotation-repeat", "zoom", "navigation", "return"));
    static final Set<String> TARGETS = new HashSet<>(Arrays.asList("world", "tasks", "stats", "settings", "canvas"));
    static final Set<String> STRINGS = new HashSet<>(Arrays.asList("startup", "idle", "rotation-first", "rotation-repeat", "zoom", "navigation", "return", "world", "tasks", "stats", "settings", "canvas", "none", "low", "balanced", "high"));
    static final Set<String> KEYS = new HashSet<>(Arrays.asList(
        "schemaVersion", "windowLabel", "measuredAtMs", "windowDurationMs", "pageVisible", "worldReady", "phases", "durations", "stages", "raf", "longTasks", "rendererCpu", "renderer", "safety", "errors", "viewport", "width", "height", "pixelRatio",
        "count", "sampled", "meanMs", "p50Ms", "p95Ms", "maxMs", "totalMs", "over34", "over50", "over100",
        "known", "idle", "activeFocus", "hasPlan", "pendingReports", "projectCount", "focusHistoryCount", "importedBlueprintCount", "progressReportCount",
        "target", "visible", "rect", "x", "y",
        "js-entry", "native-bars", "storage-load", "resume", "builtin-rewards", "lifecycle", "bootstrap-ready", "shell-frame", "world-ready", "opening-start", "opening-complete",
        "initialModuleLoadMs", "initialEnvironmentWaitMs", "initialModuleAndEnvironmentMs", "initialShaderPreparationMs", "initialPresentationPreparationMs", "clear", "layout", "terrainGeneration", "terrainMesh", "roadsAndLamps", "buildings", "naturalDecorations", "lightingAndFinalize", "sceneryPlanning", "sceneryGeometry",
        "worldRebuildCount", "renderedWorldRebuildCount", "worldRebuildLastMs", "worldRebuildTotalMs", "worldRebuildMaxMs", "firstNonemptyFrameMs", "interactionP95Ms", "interactionTotalP95Ms", "interactionTotalMaxMs", "interactionAnimationFrameP95Ms", "interactionAnimationFrameMaxMs", "interactionDelayedFrameCount", "gpuRenderP95Ms", "gpuRenderMaxMs", "gpuRenderSampleCount", "gpuTimerAvailable", "pointerMoveCount", "resizeCount", "shadowRefreshCount", "atlasPageCount", "texturedVoxelCount", "fallbackVoxelCount", "geometryVoxelCount", "openingRevealStartedCount", "openingRevealCompletedCount", "openingRevealCancelledCount", "qualityTier", "resourcePackActive", "drawCalls", "triangles", "geometries", "textures"
    ));
    static boolean validId(String value) { return value != null && value.matches("[A-Za-z0-9_-]{1,48}"); }
    static boolean canKeepScreenOn(boolean active, boolean resumed, long now, long deadline) { return active && resumed && now < deadline; }
    static boolean validNumber(double value) { return !Double.isNaN(value) && !Double.isInfinite(value) && Math.abs(value) <= 1_000_000_000; }
    private PerformanceProbePolicy() {}
}
