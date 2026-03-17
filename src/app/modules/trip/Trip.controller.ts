import catchAsync from '@/app/middlewares/catchAsync';
import { TripServices } from './Trip.service';
import { calculateTripCost } from './Trip.utils';
import type {
  TGetSuperTripDetails,
  TRequestForTripV2,
  TRideResponseV2,
  TCancelTripV2,
  TPayForTripV2,
  TAcceptTripV2,
  TStartTripV2,
  TEndTripV2,
} from './Trip.interface';
import { StatusCodes } from 'http-status-codes';
import { ParcelServices } from '../parcel/Parcel.service';
import { NotificationServices } from '../notification/Notification.service';
import { RIDE_KIND } from './Trip.constant';
import { SocketServices } from '../socket/Socket.service';
import { prisma } from '@/utils/db';

export const TripControllers = {
  getTripDetails: catchAsync(async ({ params }) => {
    const trip = await TripServices.getTripDetails(params.trip_id);

    return {
      message: 'Trip details fetched successfully',
      data: trip,
    };
  }),

  /**
   * Calculate estimated fare for a trip
   */
  calculateEstimatedFare: catchAsync(async ({ body }) => {
    const estimatedFare = await calculateTripCost(body);

    return {
      message: 'Estimated fare calculated successfully',
      data: { estimated_fare: estimatedFare, query: body },
    };
  }),

  /**
   * Get super detailed trip info for admin
   */
  getSuperTripDetails: catchAsync<TGetSuperTripDetails>(async ({ params }) => {
    const trip = await TripServices.getSuperTripDetails(params);

    return {
      message: 'Super trip details fetched successfully',
      data: trip,
    };
  }),

  /**
   * Get last trip for user or driver
   */
  getLastTrip: catchAsync(async ({ user }) => {
    let trip: any = null;
    if (user.role === 'USER') {
      trip = await TripServices.getLastUserTrip({ user_id: user.id });
    } else if (user.role === 'DRIVER') {
      trip = await TripServices.getLastDriverTrip({ driver_id: user.id });
    }

    let parcel: any = null;
    if (user.role === 'DRIVER') {
      parcel = await ParcelServices.getLastDriverParcel({
        driver_id: user.id,
      });
    } else if (user.role === 'USER') {
      parcel = await ParcelServices.getLastUserParcel({
        user_id: user.id,
      });
    }

    return {
      statusCode: trip || parcel ? StatusCodes.OK : StatusCodes.NO_CONTENT,
      message: `Last ${trip ? 'trip' : 'parcel'} fetched successfully`,
      data: {
        isParcel: Boolean(parcel && !trip),
        data: trip ?? parcel,
      },
    };
  }),

  /**
   ****** v2 Trip Request Controller *****
   */

  /**
   * Get last trip for user or driver
   */
  getLastTripV2: catchAsync(async ({ user }) => {
    let trip: any = null;
    if (user.role === 'USER') {
      trip = await TripServices.getLastUserTrip({ user_id: user.id });
    } else if (user.role === 'DRIVER') {
      trip = await TripServices.getLastDriverTrip({ driver_id: user.id });
    }

    let parcel: any = null;
    if (user.role === 'DRIVER') {
      parcel = await ParcelServices.getLastDriverParcel({
        driver_id: user.id,
      });
    } else if (user.role === 'USER') {
      parcel = await ParcelServices.getLastUserParcel({
        user_id: user.id,
      });
    }

    const data = trip ?? parcel ?? {};

    return {
      statusCode: trip || parcel ? StatusCodes.OK : StatusCodes.NO_CONTENT,
      message: `Last ${trip ? 'trip' : 'parcel'} fetched successfully`,
      data: {
        kind: trip ? RIDE_KIND.TRIP : RIDE_KIND.PARCEL,
        data: {
          ...data,
          reviews: undefined,
        },
      } satisfies TRideResponseV2,
    };
  }),

  /**
   * Request for a new trip v2
   */
  requestForTripV2: catchAsync<TRequestForTripV2>(
    async ({ body: payload, user }) => {
      const data = await TripServices.requestForTrip({
        ...payload,
        user_id: user.id,
      });

      //? Notify user that their trip request is being processed
      await NotificationServices.createNotification({
        user_id: user.id,
        title: 'Trip Request Received',
        message: 'Searching for nearby drivers...',
        type: 'INFO',
      });

      return {
        message: 'Trip request created successfully',
        data: {
          kind: RIDE_KIND.TRIP,
          data,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * Cancel trip v2
   */
  cancelTripV2: catchAsync<TCancelTripV2>(async ({ body: payload, user }) => {
    const data = await TripServices.cancelTrip({
      trip_id: payload.trip_id,
      user_id: user.id,
    });

    return {
      message: 'Trip cancelled successfully',
      data: {
        kind: RIDE_KIND.TRIP,
        data,
      } satisfies TRideResponseV2,
    };
  }),

  /**
   * Pay for trip v2
   */
  payForTripV2: catchAsync<TPayForTripV2>(async ({ body: payload, user }) => {
    const { transaction, trip, wallet } = await TripServices.payForTrip({
      trip_id: payload.trip_id,
      user_id: user.id,
    });

    //? Notify driver that trip has been paid
    SocketServices.emitToUser(trip.driver_id!, 'driver-trip', {
      kind: RIDE_KIND.TRIP,
      data: trip,
    } satisfies TRideResponseV2);

    return {
      message: 'Trip paid successfully',
      data: {
        kind: RIDE_KIND.TRIP,
        data: trip,

        //? extra info
        current_balance: wallet?.balance,
        transaction,
      } satisfies TRideResponseV2,
    };
  }),

  /**
   * Driver Part +++++++++++++++++++++++++++++
   */

  /**
   * Accept trip v2
   */
  acceptTripV2: catchAsync<TAcceptTripV2>(
    async ({ body: payload, user: driver }) => {
      const trip = await TripServices.acceptTrip({
        driver_id: driver.id,
        trip_id: payload.trip_id,
      });

      if (trip.user_id) {
        //? Notify user that driver accepted the trip
        SocketServices.emitToUser(trip.user_id, 'user-trip', {
          kind: RIDE_KIND.TRIP,
          data: trip,
        } satisfies TRideResponseV2);
      }

      return {
        message: 'Trip accepted successfully',
        data: {
          kind: RIDE_KIND.TRIP,
          data: trip,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * Driver cancel trip v2
   */
  cancelTripRequestV2: catchAsync<TCancelTripV2>(
    async ({ body: payload, user: driver }) => {
      const trip = await TripServices.driverCancelTrip({
        driver_id: driver.id,
        trip_id: payload.trip_id,
      });

      //? Emit socket event to driver about trip completion and payment
      await prisma.user.update({
        where: { id: driver.id },
        data: {
          is_online: true, //? set driver online after trip completion
        },
      });

      return {
        message: 'Trip cancelled successfully',
        data: {
          kind: RIDE_KIND.TRIP,
          data: trip,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * Start trip v2
   */
  startTripV2: catchAsync<TStartTripV2>(
    async ({ body: payload, user: driver }) => {
      const trip = await TripServices.startTrip({
        driver_id: driver.id,
        trip_id: payload.trip_id,
      });

      if (trip.user_id) {
        //? Notify user that driver started the trip
        SocketServices.emitToUser(trip.user_id, 'user-trip', {
          kind: RIDE_KIND.TRIP,
          data: trip,
        } satisfies TRideResponseV2);
      }

      return {
        message: 'Trip started successfully',
        data: {
          kind: RIDE_KIND.TRIP,
          data: trip,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * End trip v2
   */
  endTripV2: catchAsync<TEndTripV2>(async ({ user: driver, body: payload }) => {
    const trip = await TripServices.endTrip({
      driver_id: driver.id,
      trip_id: payload.trip_id,
    });

    if (trip.user_id) {
      //? Notify user that driver ended the trip
      SocketServices.emitToUser(trip.user_id, 'user-trip', {
        kind: RIDE_KIND.TRIP,
        data: trip,
      } satisfies TRideResponseV2);
    }

    return {
      message: 'Trip ended successfully',
      data: {
        kind: RIDE_KIND.TRIP,
        data: trip,
      } satisfies TRideResponseV2,
    };
  }),
};
