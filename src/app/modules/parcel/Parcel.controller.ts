import catchAsync from '@/app/middlewares/catchAsync';
import { ParcelServices } from './Parcel.service';
import { calculateParcelCost } from './Parcel.utils';
import type {
  TStartParcelV2,
  TAcceptParcelV2,
  TCancelParcelV2,
  TDeliverParcel,
  TDriverCancelParcelV2,
  TGetSuperParcelDetails,
  TPayForParcelV2,
  TRequestForParcelV2,
  TCompleteParcelDeliveryV2,
} from './Parcel.interface';
import { StatusCodes } from 'http-status-codes';
import { SocketServices } from '../socket/Socket.service';
import { NotificationServices } from '../notification/Notification.service';
import { RIDE_KIND } from '../trip/Trip.constant';
import { TRideResponseV2 } from '../trip/Trip.interface';
import { userOmit } from '../user/User.constant';
import { prisma } from '@/utils/db';

export const ParcelControllers = {
  getParcelDetails: catchAsync(async ({ params }) => {
    const parcel = await ParcelServices.getParcelDetails(params.parcel_id);

    return {
      message: 'Parcel details fetched successfully',
      data: parcel,
    };
  }),

  /**
   * Calculate estimated fare for a parcel
   */
  calculateEstimatedFare: catchAsync(async ({ body }) => {
    const estimatedFare = await calculateParcelCost(body);

    return {
      message: 'Estimated fare calculated successfully',
      data: { estimated_fare: estimatedFare, query: body },
    };
  }),

  /**
   * Get super detailed parcel info for admin
   */
  getSuperParcelDetails: catchAsync<TGetSuperParcelDetails>(
    async ({ params }) => {
      const parcel = await ParcelServices.getSuperParcelDetails(params);

      return {
        message: 'Super parcel details fetched successfully',
        data: parcel,
      };
    },
  ),

  getLastParcel: catchAsync(async ({ user }) => {
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
      statusCode: parcel ? StatusCodes.OK : StatusCodes.NO_CONTENT,
      message: 'Last parcel fetched successfully',
      data: parcel,
    };
  }),

  /**
   * Driver deliver parcel
   */
  deliverParcel: catchAsync<TDeliverParcel>(async ({ body, user: driver }) => {
    const parcel = await ParcelServices.deliverParcel({
      ...body,
      driver_id: driver.id,
    });

    if (parcel.user_id) {
      //? Notify user that their parcel is being delivered
      SocketServices.emitToUser(parcel.user_id, 'parcel:delivered', parcel);
    }

    return {
      message: 'Parcel delivery data submitted successfully',
      data: parcel,
    };
  }),

  /**
   * V2 Controllers
   */

  /**
   * request for parcel v2
   */
  requestForParcelV2: catchAsync<TRequestForParcelV2>(
    async ({ body: payload, user }) => {
      const data = await ParcelServices.requestForParcel({
        ...payload,
        user_id: user.id,
      });

      //? Notify user that their parcel request is being processed
      await NotificationServices.createNotification({
        user_id: user.id,
        title: 'Parcel Request Received',
        message: 'Searching for nearby drivers...',
        type: 'INFO',
      });

      return {
        message: 'Parcel request submitted successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * cancel parcel v2
   */
  cancelParcelV2: catchAsync<TCancelParcelV2>(
    async ({ body: payload, user }) => {
      const data = await ParcelServices.cancelParcel({
        parcel_id: payload.parcel_id,
        user_id: user.id,
      });

      return {
        message: 'Parcel cancelled successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * pay for parcel v2
   */
  payForParcelV2: catchAsync<TPayForParcelV2>(
    async ({ body: payload, user }) => {
      const { transaction, parcel, wallet } = await ParcelServices.payForParcel(
        {
          parcel_id: payload.parcel_id,
          user_id: user.id,
        },
      );

      //? Notify driver that parcel has been paid
      SocketServices.emitToUser(parcel.driver_id!, 'driver-trip', {
        kind: RIDE_KIND.PARCEL,
        data: parcel,
      } satisfies TRideResponseV2);

      return {
        message: 'Parcel paid successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data: parcel,

          //? extra data
          current_balance: wallet?.balance,
          transaction,
          parcel_id: parcel.id,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * accept parcel v2
   */
  acceptParcelV2: catchAsync<TAcceptParcelV2>(
    async ({ body: payload, user: driver }) => {
      const parcel = await ParcelServices.acceptParcel({
        driver_id: driver.id,
        parcel_id: payload.parcel_id,
      });

      if (parcel.user_id) {
        //? Notify user that their parcel has been accepted
        SocketServices.emitToUser(parcel.user_id, 'user-trip', {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2);
      }

      return {
        message: 'Parcel accepted successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * driver cancel parcel v2
   */
  driverCancelParcelV2: catchAsync<TDriverCancelParcelV2>(
    async ({ body: payload, user: driver }) => {
      const parcel = await ParcelServices.driverCancelParcel({
        driver_id: driver.id,
        parcel_id: payload.parcel_id,
      });

      //? Emit socket event to driver about trip completion and payment
      await prisma.user.update({
        where: { id: driver.id },
        data: {
          is_online: true, //? set driver online after trip completion
        },
      });

      return {
        message: 'Parcel cancelled successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * start parcel v2
   */
  startParcelV2: catchAsync<TStartParcelV2>(
    async ({ body: payload, user: driver }) => {
      const parcel = await ParcelServices.startParcel({
        driver_id: driver.id,
        parcel_id: payload.parcel_id,
      });

      if (parcel.user_id) {
        //? Notify user that their parcel delivery has started
        SocketServices.emitToUser(parcel.user_id, 'user-trip', {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2);
      }

      return {
        message: 'Parcel delivery started successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2,
      };
    },
  ),

  completeParcelDeliveryV2: catchAsync<TCompleteParcelDeliveryV2>(
    async ({ body: payload, user: driver }) => {
      const parcel = await ParcelServices.completeParcelDelivery({
        driver_id: driver.id,
        parcel_id: payload.parcel_id,
      });

      if (parcel.user_id) {
        //? Notify user that their parcel delivery is completed
        SocketServices.emitToUser(parcel.user_id, 'parcel:delivery_completed', {
          parcel,
          driver: await prisma.user.findUnique({
            where: {
              id: driver.id,
            },
            omit: userOmit.DRIVER,
            /**
             * Todo: fix driver emit data type
             */
          }),
        });
      }

      return {
        message: 'Parcel delivery completed successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2,
      };
    },
  ),

  /**
   * deliver parcel v2
   */
  deliverParcelV2: catchAsync<TDeliverParcel>(
    async ({ body, user: driver }) => {
      const parcel = await ParcelServices.deliverParcel({
        ...body,
        driver_id: driver.id,
      });

      if (parcel.user_id) {
        //? Notify user that their parcel is being delivered
        SocketServices.emitToUser(parcel.user_id, 'user-trip', {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2);
      }

      return {
        message: 'Parcel delivery data submitted successfully',
        data: {
          kind: RIDE_KIND.PARCEL,
          data: parcel,
        } satisfies TRideResponseV2,
      };
    },
  ),
};
