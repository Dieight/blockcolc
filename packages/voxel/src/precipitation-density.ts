const REFERENCE_VOLUME = 80 * 80 * 40;

/** A weather's reference count becomes a fixed number per world-space volume. */
export function precipitationCountForVolume(input: {
  referenceCount:number; qualityDensity:number; spanX:number; spanZ:number; spanY:number; capacity:number; minimum?:number;
}): number {
  const {referenceCount,qualityDensity,spanX,spanZ,spanY,capacity}=input;
  if (![referenceCount,qualityDensity,spanX,spanZ,spanY,capacity].every(Number.isFinite)
    || referenceCount<=0 || qualityDensity<=0 || spanX<=0 || spanZ<=0 || spanY<=0 || capacity<=0) return 0;
  return Math.min(Math.floor(capacity),Math.max(input.minimum??0,
    Math.round(referenceCount * qualityDensity * spanX * spanZ * spanY / REFERENCE_VOLUME)));
}
