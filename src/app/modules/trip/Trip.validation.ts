import { z } from 'zod';
import { TModelZod } from '@/types/zod';
import { Trip as TTrip } from '@/utils/db';
import { exists } from '@/utils/db/exists';

/**
 * Shared Validations
 */
const _ = {
  location_type: z.literal('Point').default('Point'),
  location_address: z.string().optional(),

  // Factory functions for location coordinates
  latitude: (fieldName = 'Location') =>
    z.coerce
      .number(`${fieldName} latitude is required`)
      .min(-90, `${fieldName} must be between -90 and 90`)
      .max(90, `${fieldName} must be between -90 and 90`),

  longitude: (fieldName = 'Location') =>
    z.coerce
      .number(`${fieldName} longitude is required`)
      .min(-180, `${fieldName} must be between -180 and 180`)
      .max(180, `${fieldName} must be between -180 and 180`),

  trip_id: z.string().refine(exists('trip'), {
    error: ({ input }) => `Trip not found with id: ${input}`,
  }),
};

const requestForTrip = z.object({
  pickup_type: _.location_type,
  pickup_lat: _.latitude('Pickup'),
  pickup_lng: _.longitude('Pickup'),
  pickup_address: _.location_address,

  dropoff_type: _.location_type,
  dropoff_lat: _.latitude('Dropoff'),
  dropoff_lng: _.longitude('Dropoff'),
  dropoff_address: _.location_address,
} satisfies TModelZod<TTrip>);

export const TripValidations = {
  calculateEstimatedFare: z.object({
    body: requestForTrip,
  }),

  //! Socket
  requestForTrip,

  refreshLocation: z.object({
    location_type: _.location_type,
    location_lat: _.latitude('Location'),
    location_lng: _.longitude('Location'),
    location_address: _.location_address,
    trip_id: _.trip_id,
  }),
  //! Socket - end

  /**
   * v2 Trip Request Validation
   */

  /**
   * Request for a new trip v2
   */
  requestForTripV2: z.object({
    body: requestForTrip,
  }),

  /**
   * Cancel Trip Validation
   */
  cancelTripV2: z.object({
    body: z.object({
      trip_id: _.trip_id,
    }),
  }),

  /**
   * Pay for Trip Validation
   */
  payForTripV2: z.object({
    body: z.object({
      trip_id: _.trip_id,
    }),
  }),

  /**
   * Driver Part +++++++++++++++++++++++++++++
   */

  /**
   * Accept Trip Validation
   */
  acceptTripV2: z.object({
    body: z.object({
      trip_id: _.trip_id,
    }),
  }),

  /**
   * Start Trip Validation
   */
  startTripV2: z.object({
    body: z.object({
      trip_id: _.trip_id,
    }),
  }),

  /**
   * End Trip Validation
   */
  endTripV2: z.object({
    body: z.object({
      trip_id: _.trip_id,
    }),
  }),
};

/**
 * Export shared validations
 */
export const tripSharedValidations = _;
