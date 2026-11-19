// Allowlist fields before model exposure. Never forward full account/profile
// envelopes, contact details, tokens, notes, or identifiers to the model.
const fields = new Set([
  'data',
  'items',
  'bootcamps',
  'availability',
  'availableTimes',
  'timeSlots',
  'name',
  'title',
  'en',
  'fr',
  'ar',
  'ar-SA',
  'day',
  'dayOfWeek',
  'date',
  'startHour',
  'endHour',
  'timeFrom',
  'timeTo',
  'startTime',
  'endTime',
  'from',
  'to',
  'startDate',
  'endDate',
  'timeZone',
  'timezone',
  'isAvailable',
  'isAvailableForBooking',
  'isUnlocked',
  'unlocked',
  'status',
]);
export function publicToolData(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'boolean' || typeof value === 'number' || value === null)
    return value;
  if (Array.isArray(value))
    return value.slice(0, 200).map((entry) => publicToolData(entry, depth + 1));
  if (typeof value !== 'object' || value === null) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => fields.has(key))
      .map(([key, entry]) => [key, publicToolData(entry, depth + 1)]),
  );
}
