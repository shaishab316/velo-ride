import { ETripStatus, prisma, TripHelper as TTripHelper } from '@/utils/db';
import { SocketServices } from '../socket/Socket.service';
import ms from 'ms';
import { errorLogger } from '@/utils/logger';
import { NotificationServices } from '../notification/Notification.service';
import { userOmit } from '../user/User.constant';
import { getNearestDriver } from '../parcel/Parcel.utils';
import { TRideResponseV2 } from './Trip.interface';
import { RIDE_KIND } from './Trip.constant';
import type { TripServices } from './Trip.service';

/**
 * Recursively searches for drivers when none are available
 */
async function searchAgainForDrivers(
  tripId: string,
  tripHelperId: string,
  pickupLat: number,
  pickupLng: number,
): Promise<void> {
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });

    //? Only continue searching if trip is still requested
    if (!trip || trip.status !== ETripStatus.REQUESTED) {
      return;
    }

    const driver_ids = await getNearestDriver({
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
    });

    if (driver_ids.length > 0) {
      const newHelper = await prisma.tripHelper.create({
        data: {
          trip_id: tripId,
          driver_ids,
          search_at: new Date(), // Retry immediately
        },
      });

      return await processSingleDriverDispatch(newHelper);
    } else {
      setTimeout(async () => {
        await searchAgainForDrivers(tripId, tripHelperId, pickupLat, pickupLng);
      }, 10_000);
    }
  } catch (error) {
    console.error('Error in searchAgainForDrivers:', error);
  }
}

export async function processSingleDriverDispatch(tripHelper: TTripHelper) {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripHelper.trip_id },
    });

    //? Only proceed if trip is still requested
    if (!trip || trip.status !== ETripStatus.REQUESTED) {
      return;
    }

    /**
     * STEP 1: Extract next driver from the queue (FIFO)
     */
    const nextDriverId = tripHelper.driver_ids[0];

    if (!nextDriverId) {
      // No drivers remaining in queue - cleanup completed helper
      await prisma.tripHelper.delete({ where: { id: tripHelper.id } });

      //? Get trip details to notify user
      const trip = await prisma.trip.findUnique({
        where: { id: tripHelper.trip_id },
        select: { id: true, user_id: true, pickup_lat: true, pickup_lng: true },
      });

      if (!trip) return;

      if (trip.user_id) {
        //? Notify user that no drivers were found
        await NotificationServices.createNotification({
          user_id: trip.user_id,
          title: 'No Drivers Available',
          message:
            'Unfortunately, no drivers are available in your area right now. Please try again later.',
          type: 'WARNING',
        });
      }

      // Start searching for drivers again
      await searchAgainForDrivers(
        trip.id,
        tripHelper.id,
        trip.pickup_lat,
        trip.pickup_lng,
      );

      return;
    }

    /**
     * STEP 2: Prepare remaining drivers for next iteration
     */
    const remainingDriverQueue = tripHelper.driver_ids.slice(1);

    /**
     * STEP 3: Mark trip as processing and driver as offline
     */
    const processingTrip = await prisma.trip.update({
      where: { id: tripHelper.trip_id },
      data: {
        is_processing: true,
        processing_driver_id: nextDriverId,
        processing_at: new Date(),
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (processingTrip.status !== ETripStatus.REQUESTED) {
      // Trip is no longer in requested state, skip dispatch
      return;
    }

    /**
     * STEP 4: Send real-time dispatch request to driver
     */
    sendDriverDispatchNotification(processingTrip);

    //? Notify driver about new trip request
    await NotificationServices.createNotification({
      user_id: nextDriverId,
      title: 'New Trip Request',
      message: 'You have a new trip request nearby. Check it out!',
      type: 'INFO',
    });

    /**
     * STEP 5: Mark driver as temporarily offline
     * - Prevents duplicate dispatch requests
     * - Gives driver time to respond to current request
     */
    await prisma.user.update({
      where: { id: nextDriverId },
      data: {
        is_online: false,
      },
    });

    /**
     * STEP 6: Handle queue management
     */
    if (remainingDriverQueue.length > 0) {
      // More drivers available - schedule next attempt in 5 seconds
      await prisma.tripHelper.update({
        where: { id: tripHelper.id },
        data: {
          driver_ids: remainingDriverQueue,
          search_at: new Date(Date.now() + ms('5s')), // Retry after 5 seconds
        },
      });
    } else {
      // No drivers remaining in queue - cleanup completed helper
      await prisma.tripHelper.delete({ where: { id: tripHelper.id } });
    }
  } catch (error) {
    errorLogger.error(`Error processing trip: ${tripHelper.id}`, error);
  }
}

/**
 * Sends real-time trip dispatch notification to driver via WebSocket
 *
 * @param processingTrip - The trip data to send to the driver
 */
function sendDriverDispatchNotification(
  trip: Awaited<ReturnType<typeof TripServices.requestForTrip>>,
): void {
  if (!trip.processing_driver_id) return;

  SocketServices.emitToUser(trip.processing_driver_id, 'driver-trip', {
    kind: RIDE_KIND.TRIP,
    data: trip,
  } satisfies TRideResponseV2);
}
