/**
 * v2 Ride Kind Constants
 *
 * ->
 * TRIP: for trip requests
 * PARCEL: for parcel requests
 * NONE: for no active requests
 * <-
 */
export const RIDE_KIND = {
  TRIP: 'TRIP',
  PARCEL: 'PARCEL',
  NONE: 'NONE',
} as const;

export const DRIVER_EARNING_PERCENTAGE = 0.85; // 85% for driver,
export const ADMIN_EARNING_PERCENTAGE = 0.15; // 15% for admin,
