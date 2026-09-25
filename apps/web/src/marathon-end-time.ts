/** Local HH:mm draft shared by full and minimal presentation; never timer truth. */
export function marathonEndInstant(draft: string, now = Date.now(), day?: 'today' | 'tomorrow'): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(draft);
  if (!match || !Number.isFinite(now)) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (!Number.isFinite(target.getTime())) return null;
  // Calendar arithmetic preserves the existing local tomorrow/DST policy.
  if (day === 'tomorrow' || (day === undefined && target.getTime() <= now)) target.setDate(target.getDate() + 1);
  return target.getTime();
}
