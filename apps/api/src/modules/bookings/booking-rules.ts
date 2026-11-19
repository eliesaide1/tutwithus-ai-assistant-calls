export const MINIMUM_BOOKING_NOTICE_MS = 2 * 24 * 60 * 60 * 1000;

export function hasMinimumBookingNotice(
  sessionStart: Date,
  now: Date,
): boolean {
  return sessionStart.getTime() >= now.getTime() + MINIMUM_BOOKING_NOTICE_MS;
}
