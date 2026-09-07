import {
  getTimeZoneDateKey,
  getTimeZoneParts,
  dateAtTimeInTimeZone,
} from "@dustwave/worker-core/date-time";
const timezone = "America/Denver";
export function weeklySlot(
  timestamp: number,
): { id: string; scheduledAt: string; deliverAt: string } | null {
  const parts = getTimeZoneParts(timestamp, timezone);
  const key = getTimeZoneDateKey(timestamp, timezone);
  if (new Date(`${key}T12:00:00Z`).getUTCDay() !== 0) return null;
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes < 7 * 60 + 45 || minutes > 9 * 60) return null;
  return {
    id: `weekly-${key}-America-Denver`,
    scheduledAt: new Date(timestamp).toISOString(),
    deliverAt: dateAtTimeInTimeZone(key, timezone, 8).toISOString(),
  };
}
export function lastDueSlot(timestamp = Date.now()): string {
  let day = getTimeZoneDateKey(timestamp, timezone);
  let date = new Date(`${day}T12:00:00Z`);
  const parts = getTimeZoneParts(timestamp, timezone);
  let back = date.getUTCDay();
  if (back === 0 && parts.hour < 9) back = 7;
  date = new Date(date.getTime() - back * 86400_000);
  day = date.toISOString().slice(0, 10);
  return `weekly-${day}-America-Denver`;
}
