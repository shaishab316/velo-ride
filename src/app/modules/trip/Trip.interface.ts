import type { z } from 'zod';
import type { TripValidations } from './Trip.validation';
import type { RIDE_KIND } from './Trip.constant';
import type { TripServices } from './Trip.service';
import type { ParcelServices } from '../parcel/Parcel.service';

/**
 * @type : validation for request for trip
 */
export type TRequestForTrip = z.infer<typeof TripValidations.requestForTrip> & {
  user_id: string;
};

export type TTripRefreshLocation = z.infer<
  typeof TripValidations.refreshLocation
>;

export type TGetSuperTripDetailsParams = {
  trip_id: string;
};

export type TGetSuperTripDetailsPayload = TGetSuperTripDetailsParams;

export type TGetSuperTripDetails = {
  params: TGetSuperTripDetailsParams;
};

/**
 * v2 Trip Request Interface
 */

/**
 * v2 Ride Response Interface
 */
export type TRideResponseV2 = {
  kind: keyof typeof RIDE_KIND;
  data:
    | Awaited<ReturnType<typeof TripServices.requestForTrip>>
    | Awaited<ReturnType<typeof ParcelServices.requestForParcel>>
    | null;
  [extra: string]: any;
};

/**
 * Request for Trip v2 Interface
 */
export type TRequestForTripV2 = z.infer<
  typeof TripValidations.requestForTripV2
>;

/**
 * Cancel Trip v2 Interface
 */
export type TCancelTripV2 = z.infer<typeof TripValidations.cancelTripV2>;

/**
 * Pay for Trip v2 Interface
 */
export type TPayForTripV2 = z.infer<typeof TripValidations.payForTripV2>;

/**
 * Accept Trip v2 Interface
 */
export type TAcceptTripV2 = z.infer<typeof TripValidations.acceptTripV2>;

/**
 * Start Trip v2 Interface
 */
export type TStartTripV2 = z.infer<typeof TripValidations.startTripV2>;

/**
 * End Trip v2 Interface
 */
export type TEndTripV2 = z.infer<typeof TripValidations.endTripV2>;
