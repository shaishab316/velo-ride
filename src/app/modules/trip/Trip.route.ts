import { Router } from 'express';
import { TripControllers } from './Trip.controller';
import purifyRequest from '@/app/middlewares/purifyRequest';
import { QueryValidations } from '../query/Query.validation';
import { TripValidations } from './Trip.validation';
import auth from '@/app/middlewares/auth';

const all = Router();
{
  //? Get last trip for user or driver
  all.get('/recover-trip', auth.all, TripControllers.getLastTrip);
  all.get('/recover-trip-v2', auth.all, TripControllers.getLastTripV2);

  //? Get trip details
  all.get(
    '/:trip_id',
    auth.all,
    purifyRequest(QueryValidations.exists('trip_id', 'trip')),
    TripControllers.getTripDetails,
  );

  //? Calculate estimated fare
  all.post(
    '/estimate-fare',
    purifyRequest(TripValidations.calculateEstimatedFare),
    TripControllers.calculateEstimatedFare,
  );

  /**
   * v2 Trip Request Route
   */

  /**
   * Request for a new trip v2
   *
   * [user] Requests a new trip by providing pickup and dropoff details.
   */
  all.post(
    '/new-trip-request',
    auth.user,
    purifyRequest(TripValidations.requestForTripV2),
    TripControllers.requestForTripV2,
  );

  /**
   * Cancel trip v2
   *
   * [user] Cancels an ongoing trip by providing the trip ID.
   */
  all.post(
    '/cancel-trip',
    auth.user,
    purifyRequest(TripValidations.cancelTripV2),
    TripControllers.cancelTripV2,
  );

  /**
   * Pay for trip v2
   *
   * [user] Pays for a completed trip by providing payment details.
   */
  all.post(
    '/pay-trip' /** Todo: not tested yet */,
    auth.user,
    purifyRequest(TripValidations.payForTripV2),
    TripControllers.payForTripV2,
  );

  /**
   * Driver Routes +++++++++++++++++++++++++++++
   */

  /**
   * Accept trip v2
   *
   * [driver] Accepts a trip request by providing the trip ID.
   */
  all.post(
    '/accept-trip-request',
    auth.driver,
    purifyRequest(TripValidations.acceptTripV2),
    TripControllers.acceptTripV2,
  );

  /**
   * Cancel trip request v2
   *
   * [driver] Cancels a trip request by providing the trip ID.
   */
  all.post(
    '/cancel-trip-request',
    auth.driver,
    purifyRequest(TripValidations.cancelTripV2),
    TripControllers.cancelTripRequestV2,
  );

  /**
   * Start trip v2
   *
   * [driver] Starts a trip by providing the trip ID.
   */
  all.post(
    '/start-trip',
    auth.driver,
    purifyRequest(TripValidations.startTripV2),
    TripControllers.startTripV2,
  );

  /**
   * End trip v2
   *
   * [driver] Ends a trip by providing the trip ID.
   */
  all.post(
    '/end-trip',
    auth.driver,
    purifyRequest(TripValidations.endTripV2),
    TripControllers.endTripV2,
  );
}

const admin = Router();
{
  //? Get super trip details
  admin.get(
    '/:trip_id',
    purifyRequest(QueryValidations.exists('trip_id', 'trip')),
    TripControllers.getSuperTripDetails,
  );
}

export const TripRoutes = { all, admin };
