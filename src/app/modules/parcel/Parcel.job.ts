import { prisma, ParcelHelper as TParcelHelper } from '@/utils/db';
import { SocketServices } from '../socket/Socket.service';
import ms from 'ms';
import { errorLogger } from '@/utils/logger';
import { NotificationServices } from '../notification/Notification.service';
import { userOmit } from '../user/User.constant';
import { getNearestDriver } from './Parcel.utils';
import { TRideResponseV2 } from '../trip/Trip.interface';
import type { ParcelServices } from './Parcel.service';
import { RIDE_KIND } from '../trip/Trip.constant';

/**
 * Recursively searches for drivers when none are available
 */
async function searchAgainForDrivers(
  parcelId: string,
  pickupLat: number,
  pickupLng: number,
): Promise<void> {
  try {
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });

    //? Only continue searching if parcel is still in REQUESTED status
    if (!parcel || parcel.status !== 'REQUESTED') {
      return;
    }

    const driver_ids = await getNearestDriver({
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
    });

    if (driver_ids.length > 0) {
      const newHelper = await prisma.parcelHelper.create({
        data: {
          parcel_id: parcelId,
          driver_ids,
          search_at: new Date(), // Retry immediately
        },
      });

      return await processSingleDriverDispatch(newHelper);
    } else {
      setTimeout(async () => {
        // Check if parcel is still pending before retrying
        const parcel = await prisma.parcel.findUnique({
          where: { id: parcelId },
          select: { status: true },
        });

        // Only continue searching if parcel is still in REQUESTED status
        if (parcel && parcel.status === 'REQUESTED') {
          await searchAgainForDrivers(parcelId, pickupLat, pickupLng);
        }
      }, 10_000); // 10 seconds delay
    }
  } catch (error) {
    console.error('Error in searchAgainForDrivers:', error);
  }
}

export async function processSingleDriverDispatch(parcelHelper: TParcelHelper) {
  try {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcelHelper.parcel_id },
    });

    //? Only proceed if parcel is still in REQUESTED status
    if (!parcel || parcel.status !== 'REQUESTED') {
      return;
    }

    /**
     * STEP 1: Extract next driver from the queue (FIFO)
     */
    const nextDriverId = parcelHelper.driver_ids[0];

    if (!nextDriverId) {
      // No drivers remaining in queue - cleanup completed helper
      await prisma.parcelHelper.delete({ where: { id: parcelHelper.id } });

      //? Get parcel details to notify user
      const parcel = await prisma.parcel.findUnique({
        where: { id: parcelHelper.parcel_id },
        select: { id: true, user_id: true, pickup_lat: true, pickup_lng: true },
      });

      if (!parcel) return;

      if (parcel.user_id) {
        //? Notify user that no drivers were found
        await NotificationServices.createNotification({
          user_id: parcel.user_id,
          title: 'No Drivers Available',
          message:
            'Unfortunately, no drivers are available in your area right now. Please try again later.',
          type: 'WARNING',
        });
      }

      // Start searching for drivers again
      await searchAgainForDrivers(
        parcel.id,
        parcel.pickup_lat,
        parcel.pickup_lng,
      );

      return;
    }

    /**
     * STEP 2: Prepare remaining drivers for next iteration
     */
    const remainingDriverQueue = parcelHelper.driver_ids.slice(1);

    /**
     * STEP 3: Mark parcel as processing and driver as offline
     */
    const processingParcel = await prisma.parcel.update({
      where: { id: parcelHelper.parcel_id },
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

    if (processingParcel.status !== 'REQUESTED') {
      //? Only proceed if parcel is still requested
      return;
    }

    /**
     * STEP 4: Send real-time dispatch request to driver
     */
    sendDriverDispatchNotification(processingParcel);

    //? Notify driver about new parcel request
    await NotificationServices.createNotification({
      user_id: nextDriverId,
      title: 'New Parcel Request',
      message: 'You have a new parcel delivery request nearby. Check it out!',
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
      await prisma.parcelHelper.update({
        where: { id: parcelHelper.id },
        data: {
          driver_ids: remainingDriverQueue,
          search_at: new Date(Date.now() + ms('5s')), // Retry after 5 seconds
        },
      });
    } else {
      // No drivers remaining in queue - cleanup completed helper
      await prisma.parcelHelper.delete({ where: { id: parcelHelper.id } });
    }
  } catch (error) {
    errorLogger.error(`Error processing parcel: ${parcelHelper.id}`, error);
  }
}

/**
 * Sends real-time parcel dispatch notification to driver via WebSocket
 *
 * @param processingParcel - The parcel data to send to the driver
 */
function sendDriverDispatchNotification(
  parcel: Awaited<ReturnType<typeof ParcelServices.requestForParcel>>,
): void {
  if (!parcel.processing_driver_id) return;
  SocketServices.emitToUser(parcel.processing_driver_id, 'driver-trip', {
    kind: RIDE_KIND.PARCEL,
    data: parcel,
  } satisfies TRideResponseV2);
}
