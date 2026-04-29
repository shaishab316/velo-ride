import { StatusCodes } from 'http-status-codes';
import ServerError from '@/errors/ServerError';
import { ETransactionType, ETripStatus, prisma } from '@/utils/db';
import type {
  TGetSuperTripDetailsPayload,
  TRequestForTrip,
  TRideResponseV2,
  TTripRefreshLocation,
} from './Trip.interface';
import { calculateTripCost, generateTripSlug } from './Trip.utils';
import { getNearestDriver } from '../parcel/Parcel.utils';
import { userOmit } from '../user/User.constant';
import { NotificationServices } from '../notification/Notification.service';
import { SocketServices } from '../socket/Socket.service';
import { processSingleDriverDispatch } from './Trip.job';
import { DRIVER_EARNING_PERCENTAGE, RIDE_KIND } from './Trip.constant';

export const TripServices = {
  async getTripDetails(trip_id: string) {
    return prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: {
          omit: userOmit.USER,
        },
        driver: {
          omit: userOmit.DRIVER,
        },
      },
    });
  },

  //! Socket
  async requestForTrip(payload: TRequestForTrip) {
    // ✅ Check if user has enough balance in wallet
    const userWallet = await prisma.wallet.findUnique({
      where: { id: payload.user_id },
    });

    if (!userWallet) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'User wallet not found');
    }

    const driver_ids = await getNearestDriver(payload);

    const totalCost = await calculateTripCost(payload);

    // ✅ Verify sufficient balance before creating trip
    if (userWallet.balance < totalCost) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        `Insufficient balance. Required: € ${totalCost.toFixed(2)}, Available: € ${userWallet.balance.toFixed(2)}`,
      );
    }

    const driverEarning = totalCost * DRIVER_EARNING_PERCENTAGE;
    const adminEarning = totalCost - driverEarning;

    const { helper, ...trip } = await prisma.trip.create({
      data: {
        ...payload,
        slug: await generateTripSlug(),
        total_cost: totalCost,
        driver_earning: +driverEarning.toFixed(2),
        admin_earning: +adminEarning.toFixed(2),
        date: new Date().toISOString().split('T')[0], // "YYYY-MM-DD"
        helper: {
          create: {
            driver_ids,
          },
        },
      },
      include: {
        helper: true,
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (helper) {
      await processSingleDriverDispatch(helper);
    }

    return trip;
  },

  async acceptTrip({
    trip_id,
    driver_id,
  }: {
    trip_id: string;
    driver_id: string;
  }) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (!trip) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'Trip not found');
    }

    if (trip?.driver?.id && trip?.driver?.id !== driver_id) {
      throw new ServerError(
        StatusCodes.CONFLICT,
        `${trip?.driver?.name?.split(' ')[0]} is already accepted this trip`,
      );
    }

    if (trip.status === ETripStatus.ACCEPTED) {
      return trip;
    } else if (trip.status !== ETripStatus.REQUESTED) {
      throw new ServerError(
        StatusCodes.CONFLICT,
        `This trip is already ${trip.status.toLowerCase()}`,
      );
    }

    const updatedTrip = await prisma.trip.update({
      where: { id: trip_id },
      data: {
        status: ETripStatus.ACCEPTED,
        driver_id,
        accepted_at: new Date(),
        is_processing: false,
        processing_driver_id: null,
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
        reviews: { select: { reviewer_id: true } },
      },
    });

    //? sort for consistent chat user_ids
    const user_ids = [updatedTrip.user_id, driver_id].sort();

    //? Create chat for trip
    let chat = await prisma.chat.findFirst({
      where: { user_ids: { equals: user_ids.filter(id => id !== null) } },
    });

    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          user_ids: user_ids.filter(id => id !== null),
        },
      });
    }

    //? Initial message
    await prisma.message.create({
      data: {
        chat_id: chat.id,
        user_id: driver_id,
        text: "Hi! I'am your driver. I'm here to assist you with your trip.",
      },
    });

    if (updatedTrip.user_id) {
      //? Notify user about trip acceptance
      await NotificationServices.createNotification({
        user_id: updatedTrip.user_id,
        title: 'Trip Accepted',
        message: 'A driver has accepted your trip request.',
        type: 'INFO',
      });
    }

    //? Increment driver's trip given count
    await prisma.user.update({
      where: { id: driver_id },
      data: {
        trip_given_count: {
          increment: 1,
        },
      },
    });

    //? Increment user's trip received count
    if (trip.user_id) {
      await prisma.user.update({
        where: { id: trip.user_id },
        data: {
          trip_received_count: {
            increment: 1,
          },
        },
      });
    }

    //! Auto payment on driver accept for better UX, can be moved to trip completion if needed
    await this.payForTrip({
      user_id: updatedTrip.user_id!,
      trip_id: updatedTrip.id,
    });

    return updatedTrip;
  },

  async cancelTrip({ trip_id, user_id }: { trip_id: string; user_id: string }) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: {
          select: {
            name: true,
            id: true,
          },
        },
        helper: true,
      },
    });

    if (trip?.user?.id !== user_id)
      throw new ServerError(
        StatusCodes.CONFLICT,
        `You can't cancel ${trip?.user?.name?.split(' ')[0]}'s trip`,
      );

    const cancelledTrip = await prisma.trip.update({
      where: { id: trip_id },
      data: {
        status: ETripStatus.CANCELLED,
        cancelled_at: new Date(),
        is_processing: false,
        processing_driver_id: null,
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    //? Notify driver if assigned

    if (trip.status === ETripStatus.REQUESTED && trip.processing_driver_id) {
      await NotificationServices.createNotification({
        user_id: trip.processing_driver_id,
        title: 'Trip Cancelled',
        message: 'The user has cancelled the trip.',
        type: 'WARNING',
      });
    } else if (trip.driver_id) {
      await NotificationServices.createNotification({
        user_id: trip.driver_id,
        title: 'Trip Cancelled',
        message: 'The user has cancelled the trip.',
        type: 'WARNING',
      });
    }

    if (trip.driver_id) {
      SocketServices.emitToUser(trip.driver_id, 'driver-trip', {
        kind: RIDE_KIND.TRIP,
        data: cancelledTrip,
      } satisfies TRideResponseV2);
    }

    if (trip.processing_driver_id) {
      SocketServices.emitToUser(trip.processing_driver_id, 'driver-trip', {
        kind: RIDE_KIND.TRIP,
        data: cancelledTrip,
      } satisfies TRideResponseV2);
    }

    const driverId = trip.driver_id || trip.processing_driver_id;

    if (driverId) {
      await prisma.user.update({
        where: { id: driverId },
        data: {
          is_online: true, //? set driver online after trip cancellation
        },
      });
    }

    if (trip.payment_at) {
      //? Auto refund if trip was paid
      await this.refundTrip(trip_id);
    }

    return cancelledTrip;
  },

  async getProcessingDriverTrip({ driver_id }: { driver_id: string }) {
    return prisma.trip.findFirst({
      where: { processing_driver_id: driver_id },
      orderBy: { processing_at: 'desc' },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });
  },

  async getLastUserTrip({ user_id }: { user_id: string }) {
    const trip = await prisma.trip.findFirst({
      where: {
        user_id,
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
        reviews: { select: { reviewer_id: true } },
      },
      orderBy: {
        requested_at: 'desc',
      },
    });

    if (
      trip?.status === ETripStatus.COMPLETED ||
      trip?.status === ETripStatus.CANCELLED
    ) {
      return;
    }

    return trip;
  },

  async getLastDriverTrip({ driver_id }: { driver_id: string }) {
    const trip = await prisma.trip.findFirst({
      where: {
        OR: [{ driver_id }, { processing_driver_id: driver_id }],
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
        reviews: { select: { reviewer_id: true } },
      },
      orderBy: {
        accepted_at: 'desc',
      },
    });

    if (
      trip?.status === ETripStatus.COMPLETED ||
      trip?.status === ETripStatus.CANCELLED
    ) {
      return;
    }

    return trip;
  },

  async refreshLocation({ trip_id, ...payload }: TTripRefreshLocation) {
    return prisma.trip.update({
      where: { id: trip_id },
      data: payload,
      /** no-need */
      // include: {
      //   user: { omit: userOmit.USER },
      //   driver: { omit: userOmit.DRIVER },
      // }
    });
  },

  async driverCancelTrip({
    trip_id,
    driver_id,
  }: {
    trip_id: string;
    driver_id: string;
  }) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (!trip) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'Trip not found');
    }

    if (trip.status === ETripStatus.REQUESTED) {
      if (trip.processing_driver_id !== driver_id) {
        throw new ServerError(
          StatusCodes.FORBIDDEN,
          'You are not assigned to this trip',
        );
      }
    } else if (trip.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this trip',
      );
    }

    if (trip.status === ETripStatus.REQUESTED) {
      const updatedTrip = await prisma.trip.update({
        where: { id: trip_id },
        data: {
          processing_driver_id: null,
          is_processing: false,
          processing_at: new Date(), //? invoke time
        },
        select: {
          helper: true,
        },
      });

      if (!updatedTrip.helper) return trip;

      //? Proceed to next driver in queue
      await processSingleDriverDispatch(updatedTrip.helper);
    } else {
      await prisma.trip.update({
        where: { id: trip_id },
        data: {
          status: ETripStatus.CANCELLED,
          cancelled_at: new Date(),
        },
      });

      await NotificationServices.createNotification({
        user_id: trip.user_id!,
        title: 'Trip Cancelled by Driver',
        message: 'The driver has cancelled the trip.',
        type: 'WARNING',
      });
    }

    return trip;
  },

  async startTrip({
    trip_id,
    driver_id,
  }: {
    trip_id: string;
    driver_id: string;
  }) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
    });

    if (trip?.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this trip',
      );
    }

    const startedTrip = await prisma.trip.update({
      where: { id: trip_id },
      data: {
        status: ETripStatus.STARTED,
        started_at: new Date(),
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
        reviews: { select: { reviewer_id: true } },
      },
    });

    if (startedTrip.user_id) {
      //? Notify user that trip has started
      await NotificationServices.createNotification({
        user_id: startedTrip.user_id,
        title: 'Trip Started',
        message: 'Your trip has started. Enjoy your ride!',
        type: 'INFO',
      });
    }

    return startedTrip;
  },

  async endTrip({
    trip_id,
    driver_id,
  }: {
    trip_id: string;
    driver_id: string;
  }) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
    });

    if (trip?.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this trip',
      );
    }

    trip.started_at ??= new Date();

    const arrived_at = new Date();

    const completedTrip = await prisma.trip.update({
      where: { id: trip_id },
      data: {
        status: ETripStatus.COMPLETED,
        arrived_at,
        completed_at: new Date(),

        //? Calculate total time in milliseconds
        time: arrived_at.getTime() - trip.started_at.getTime(),

        //? Recalculate total cost in case of any changes during the trip
        total_cost: await calculateTripCost(trip as any),
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
        reviews: { select: { reviewer_id: true } },
      },
    });

    if (completedTrip.user_id) {
      //? Notify user that trip has ended
      await NotificationServices.createNotification({
        user_id: completedTrip.user_id,
        title: 'Trip Completed',
        message: `Your trip has been completed. Total cost: € ${completedTrip.total_cost}`,
        type: 'INFO',
      });
    }

    return completedTrip;
  },

  async payForTrip({ user_id, trip_id }: { user_id: string; trip_id: string }) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (!trip || trip.user_id !== user_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not authorized to pay for this trip',
      );
    }

    if (trip.payment_at) {
      return {
        trip,
        wallet: await prisma.wallet.findUnique({ where: { id: user_id } }),
        transaction: await prisma.transaction.findFirst({
          where: { ref_trip_id: trip_id },
        }),
      };
    }

    if (trip.status === ETripStatus.REQUESTED) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'Trip has not started yet',
      );
    } else if (trip.status === ETripStatus.CANCELLED) {
      throw new ServerError(StatusCodes.BAD_REQUEST, 'Trip was cancelled');
    } else if (trip.status === ETripStatus.COMPLETED) {
      throw new ServerError(StatusCodes.BAD_REQUEST, 'Trip already completed');
    }

    const result = await prisma.$transaction(async tx => {
      const updatedTrip = await tx.trip.update({
        where: { id: trip_id },
        data: {
          payment_at: new Date(),
        },
        include: {
          user: { omit: userOmit.USER },
          driver: { omit: userOmit.DRIVER },
        },
      });

      // ✅ Deduct from user wallet — check balance immediately
      const wallet = await tx.wallet.update({
        where: { id: user_id },
        data: {
          balance: { decrement: updatedTrip.total_cost },
          total_expend: { increment: updatedTrip.total_cost },
        },
      });

      // ✅ Balance check BEFORE crediting driver
      if (wallet.balance < 0) {
        throw new ServerError(
          StatusCodes.BAD_REQUEST,
          'Insufficient balance in wallet',
        );
      }

      // ✅ Credit driver
      await tx.wallet.update({
        where: { id: updatedTrip.driver_id! },
        data: {
          balance: { increment: updatedTrip.driver_earning ?? 0 },
          total_income: { increment: updatedTrip.driver_earning ?? 0 },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          user_id,
          amount: updatedTrip.total_cost,
          type: ETransactionType.EXPENSE,
          ref_trip_id: trip_id,
          payment_method: 'WALLET',
        },
      });

      await tx.transaction.create({
        data: {
          user_id: updatedTrip.driver_id!,
          amount: updatedTrip.driver_earning ?? 0,
          type: ETransactionType.INCOME,
          ref_trip_id: trip_id,
          payment_method: 'WALLET',
        },
      });

      await tx.user.update({
        where: { id: updatedTrip.driver_id! },
        data: { trip_given_count: { increment: 1 }, is_online: true },
      });

      await tx.user.update({
        where: { id: user_id },
        data: { trip_received_count: { increment: 1 } },
      });

      return { trip: updatedTrip, wallet, transaction };
    });

    await NotificationServices.createNotification({
      user_id,
      title: 'Payment Successful',
      message: `Payment of € ${result.trip.total_cost} completed successfully.`,
      type: 'INFO',
    });

    await NotificationServices.createNotification({
      user_id: result.trip.driver_id!,
      title: 'Payment Received',
      message: `You received € ${result.trip.driver_earning} for the completed trip.`,
      type: 'INFO',
    });

    if (result.wallet.balance < 10) {
      await NotificationServices.createNotification({
        user_id,
        title: 'Low Wallet Balance',
        message: `Your wallet balance is low (€ ${result.wallet.balance.toFixed(2)}). Please top up.`,
        type: 'WARNING',
      });
    }

    return result;
  },

  /**
   * Get super detailed trip info for admin
   */
  async getSuperTripDetails({ trip_id }: TGetSuperTripDetailsPayload) {
    return prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: {
          omit: {
            ...userOmit.USER,
            email: false,
          },
        },
        driver: {
          omit: {
            ...userOmit.DRIVER,
            email: false,
          },
        },
      },
    });
  },

  async refundTrip(trip_id: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: trip_id },
      include: {
        user: {
          omit: {
            ...userOmit.USER,
            email: false,
          },
        },
        driver: {
          omit: {
            ...userOmit.DRIVER,
            email: false,
          },
        },
      },
    });

    if (!trip) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'Trip not found');
    }

    if (!trip.payment_at) {
      return; //! dont throw error if trip was not paid, just return
    }

    const updatedTrip = await prisma.$transaction(async tx => {
      const updatedTrip = await tx.trip.update({
        where: { id: trip_id },
        data: {
          payment_at: null,
        },
        include: {
          user: { omit: userOmit.USER },
          driver: { omit: userOmit.DRIVER },
        },
      });

      await tx.wallet.update({
        where: { id: trip.user_id! },
        data: {
          balance: { increment: trip.total_cost },
          total_expend: { decrement: trip.total_cost },
        },
      });

      await tx.wallet.update({
        where: { id: trip.driver_id! },
        data: {
          balance: { decrement: trip.driver_earning ?? 0 },
          total_income: { decrement: trip.driver_earning ?? 0 },
        },
      });

      await tx.transaction.create({
        data: {
          user_id: trip.user_id!,
          amount: trip.total_cost,
          type: ETransactionType.INCOME,
          ref_trip_id: trip_id,
          payment_method: 'WALLET',
        },
      });

      await tx.transaction.create({
        data: {
          user_id: trip.driver_id!,
          amount: trip.driver_earning ?? 0,
          type: ETransactionType.EXPENSE,
          ref_trip_id: trip_id,
          payment_method: 'WALLET',
        },
      });

      return updatedTrip;
    });

    await NotificationServices.createNotification({
      user_id: trip.user_id!,
      title: 'Trip Refunded',
      message: `Your trip has been refunded. Amount € ${trip.total_cost} has been credited back to your wallet.`,
      type: 'INFO',
    });

    await NotificationServices.createNotification({
      user_id: trip.driver_id!,
      title: 'Trip Refund Processed',
      message: `The trip with ID ${trip.id} has been refunded. Amount € ${trip.driver_earning} has been debited from your wallet.`,
      type: 'INFO',
    });

    return updatedTrip;
  },
};
