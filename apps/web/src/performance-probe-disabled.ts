import type { ApplicationService } from '@blockcolc/application';
import type { RendererDiagnostics } from '@blockcolc/voxel';

// Vite aliases the diagnostic module to this tiny inert facade in normal APKs.
// There is no collector, global API, observer, rAF loop or diagnostic transport.
export function installPerformanceProbe() {}
export function markPerformancePhase(_phase: string) {}
export function bindPerformanceApplication(_service: ApplicationService) {}
export function bindPerformanceRenderer(_read: () => RendererDiagnostics) { return () => {}; }
export function performanceProbeFrameCallback(): undefined { return undefined; }
export function measurePerformanceStage<T>(_stage: string, operation: () => Promise<T>): Promise<T> { return operation(); }
