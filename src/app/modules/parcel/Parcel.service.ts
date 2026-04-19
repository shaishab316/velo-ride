import { StatusCodes } from 'http-status-codes';
import ServerError from '@/errors/ServerError';
import { EParcelStatus, ETransactionType, prisma } from '@/utils/db';
import type {
  TCompleteParcelDeliveryArgs,
  TDeliverParcelArgs,
  TGetSuperParcelDetailsPayload,
  TParcelRefreshLocation,
  TRequestForParcel,
  TStartParcelArgs,
} from './Parcel.interface';
import {
  calculateParcelCost,
  generateParcelSlug,
  getNearestDriver,
} from './Parcel.utils';
import { userOmit } from '../user/User.constant';
import { NotificationServices } from '../notification/Notification.service';
import { SocketServices } from '../socket/Socket.service';
import { processSingleDriverDispatch } from './Parcel.job';
import { DRIVER_EARNING_PERCENTAGE, RIDE_KIND } from '../trip/Trip.constant';
import { TRideResponseV2 } from '../trip/Trip.interface';

export const ParcelServices = {
  async getParcelDetails(parcel_id: string) {
    return prisma.parcel.findUnique({
      where: { id: parcel_id },
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
  async requestForParcel(payload: TRequestForParcel) {
    const driver_ids = await getNearestDriver(payload);

    const totalCost = await calculateParcelCost(payload);
    const driverEarning = totalCost * DRIVER_EARNING_PERCENTAGE;
    const adminEarning = totalCost - driverEarning;

    const { helper, ...parcel } = await prisma.parcel.create({
      data: {
        ...payload,
        slug: await generateParcelSlug(),
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

    return parcel;
  },

  async acceptParcel({
    parcel_id,
    driver_id,
  }: {
    parcel_id: string;
    driver_id: string;
  }) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (!parcel) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'Parcel not found');
    }

    if (parcel?.driver?.id && parcel?.driver?.id !== driver_id)
      throw new ServerError(
        StatusCodes.CONFLICT,
        `${parcel?.driver?.name?.split(' ')[0]} is already accepted this parcel`,
      );

    if (parcel.status === EParcelStatus.ACCEPTED) {
      return parcel;
    } else if (parcel.status !== EParcelStatus.REQUESTED) {
      throw new ServerError(
        StatusCodes.CONFLICT,
        `This trip is already ${parcel.status.toLowerCase()}`,
      );
    }

    const acceptedParcel = await prisma.parcel.update({
      where: { id: parcel_id },
      data: {
        status: EParcelStatus.ACCEPTED,
        driver_id,
        accepted_at: new Date(),
        is_processing: true,
        processing_driver_id: null,
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (acceptedParcel.user_id) {
      //? Notify user about parcel acceptance
      await NotificationServices.createNotification({
        user_id: acceptedParcel.user_id,
        title: 'Parcel Accepted',
        message: 'A driver has accepted your parcel delivery request.',
        type: 'INFO',
      });
    }

    //? Update driver trip given count
    await prisma.user.update({
      where: { id: driver_id },
      data: {
        trip_given_count: {
          increment: 1,
        },
      },
    });

    //? Update user trip received count
    if (parcel.user_id) {
      await prisma.user.update({
        where: { id: parcel.user_id },
        data: {
          trip_received_count: {
            increment: 1,
          },
        },
      });
    }

    await this.payForParcel({
      user_id: acceptedParcel.user_id!,
      parcel_id: acceptedParcel.id,
    });

    return acceptedParcel;
  },

  async cancelParcel({
    parcel_id,
    user_id,
  }: {
    parcel_id: string;
    user_id: string;
  }) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
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

    if (parcel?.user?.id !== user_id)
      throw new ServerError(
        StatusCodes.CONFLICT,
        `You can't cancel ${parcel?.user?.name?.split(' ')[0]}'s parcel`,
      );

    const cancelledParcel = await prisma.parcel.update({
      where: { id: parcel_id },
      data: {
        status: EParcelStatus.CANCELLED,
        cancelled_at: new Date(),
        is_processing: false,
        processing_driver_id: null,
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (
      parcel.status === EParcelStatus.REQUESTED &&
      parcel.processing_driver_id
    ) {
      await NotificationServices.createNotification({
        user_id: parcel.processing_driver_id,
        title: 'Parcel Cancelled',
        message:
          'The parcel you were processing has been cancelled by the user.',
        type: 'WARNING',
      });
    } else if (parcel.driver_id) {
      await NotificationServices.createNotification({
        user_id: parcel.driver_id,
        title: 'Parcel Cancelled',
        message: 'The parcel assigned to you has been cancelled by the user.',
        type: 'WARNING',
      });
    }

    //? Notify assigned drivers about cancellation
    if (parcel.driver_id) {
      SocketServices.emitToUser(parcel.driver_id, 'driver-trip', {
        kind: RIDE_KIND.PARCEL,
        data: cancelledParcel,
      } satisfies TRideResponseV2);
    }

    //? Notify processing driver about cancellation
    if (parcel.processing_driver_id) {
      SocketServices.emitToUser(parcel.processing_driver_id, 'driver-trip', {
        kind: RIDE_KIND.PARCEL,
        data: cancelledParcel,
      } satisfies TRideResponseV2);
    }

    const driverId = parcel.driver_id || parcel.processing_driver_id;

    if (driverId) {
      //? Emit socket event to driver about trip completion and payment
      await prisma.user.update({
        where: { id: driverId },
        data: {
          is_online: true, //? set driver online after trip completion
        },
      });
    }

    if (parcel.payment_at) {
      await this.refundParcel(parcel_id);
    }

    return cancelledParcel;
  },

  async getProcessingDriverParcel({ driver_id }: { driver_id: string }) {
    const data = await prisma.parcel.findFirst({
      where: { processing_driver_id: driver_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
      orderBy: { processing_at: 'desc' },
    });

    if (!data) {
      return null;
    }

    const { user, driver } = data;

    return {
      parcel: data,
      user,
      driver,
    };
  },

  async getLastUserParcel({ user_id }: { user_id: string }) {
    const parcel = await prisma.parcel.findFirst({
      where: {
        user_id,
        status: {
          notIn: [EParcelStatus.COMPLETED, EParcelStatus.CANCELLED],
        },
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
      parcel?.status === EParcelStatus.COMPLETED ||
      parcel?.status === EParcelStatus.CANCELLED
    ) {
      return;
    }

    return parcel;
  },

  async getLastDriverParcel({ driver_id }: { driver_id: string }) {
    const parcel = await prisma.parcel.findFirst({
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
      parcel?.status === EParcelStatus.COMPLETED ||
      parcel?.status === EParcelStatus.CANCELLED
    ) {
      return;
    }

    return parcel;
  },

  async refreshLocation({ parcel_id, ...payload }: TParcelRefreshLocation) {
    return prisma.parcel.update({
      where: { id: parcel_id },
      data: payload,
    });
  },

  async driverCancelParcel({
    parcel_id,
    driver_id,
  }: {
    parcel_id: string;
    driver_id: string;
  }) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (!parcel) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'Parcel not found');
    }

    if (parcel?.status === EParcelStatus.REQUESTED) {
      if (parcel?.processing_driver_id !== driver_id) {
        throw new ServerError(
          StatusCodes.FORBIDDEN,
          'You are not assigned to this parcel',
        );
      }
    } else if (parcel?.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this parcel',
      );
    }

    if (parcel.status === EParcelStatus.REQUESTED) {
      const updatedParcel = await prisma.parcel.update({
        where: { id: parcel_id },
        data: {
          processing_driver_id: null,
          is_processing: false,
          processing_at: new Date(), //? invoke time
        },
        select: {
          helper: true,
        },
      });

      if (!updatedParcel.helper) return parcel;

      //? re-enqueue parcel for dispatch processing
      await processSingleDriverDispatch(updatedParcel.helper);
    } else {
      await prisma.parcel.update({
        where: { id: parcel_id },
        data: {
          status: EParcelStatus.CANCELLED,
          cancelled_at: new Date(),
        },
      });

      await NotificationServices.createNotification({
        user_id: parcel.user_id!,
        title: 'Parcel Cancelled by Driver',
        message: 'The driver has cancelled your parcel delivery.',
        type: 'WARNING',
      });
    }

    return parcel;
  },

  //? New method to start parcel
  async startParcel({ driver_id, parcel_id }: TStartParcelArgs) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (parcel?.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this parcel',
      );
    }

    if (parcel.status === EParcelStatus.STARTED) {
      return parcel; //? already started
    }

    if (parcel.status !== EParcelStatus.ACCEPTED) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'Parcel is not accepted yet',
      );
    }

    await NotificationServices.createNotification({
      user_id: parcel.user_id!,
      title: 'Parcel Delivery Started',
      message: 'The driver has started delivering your parcel.',
      type: 'INFO',
    });

    return prisma.parcel.update({
      where: { id: parcel_id },
      data: {
        status: EParcelStatus.STARTED,
        started_at: new Date(),
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });
  },

  async deliverParcel({ driver_id, files, parcel_id }: TDeliverParcelArgs) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
    });

    if (parcel?.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this parcel',
      );
    }

    if (
      parcel.status !== EParcelStatus.DELIVERED &&
      parcel.status !== EParcelStatus.STARTED
    ) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'Parcel is not started yet',
      );
    }

    await NotificationServices.createNotification({
      user_id: parcel.user_id!,
      title: 'Parcel Delivered',
      message: 'Your parcel has been delivered successfully.',
      type: 'INFO',
    });

    return prisma.parcel.update({
      where: { id: parcel_id },
      data: {
        status: EParcelStatus.COMPLETED,
        completed_at: new Date(),
        delivered_at: new Date(),
        delivery_proof_files: files,
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });
  },

  async payForParcel({
    user_id,
    parcel_id,
  }: {
    user_id: string;
    parcel_id: string;
  }) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (parcel?.user_id !== user_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not authorized to pay for this parcel',
      );
    }

    if (parcel.payment_at) {
      return {
        parcel,
        wallet: await prisma.wallet.findUnique({ where: { id: user_id } }),
        transaction: await prisma.transaction.findFirst({
          where: { ref_parcel_id: parcel_id },
        }),
      };
    }

    return prisma.$transaction(async tx => {
      //? Mark parcel as paid and completed
      const parcel = await tx.parcel.update({
        where: { id: parcel_id },
        data: {
          payment_at: new Date(),
        },
        include: {
          user: { omit: userOmit.USER },
          driver: { omit: userOmit.DRIVER },
        },
      });

      //? Deduct from wallet
      const wallet = await tx.wallet.update({
        where: { id: user_id },
        data: {
          balance: {
            decrement: parcel.total_cost,
          },
        },
      });

      //? add balance to driver's wallet
      await tx.wallet.update({
        where: { id: parcel.driver_id! },
        data: {
          balance: {
            increment: parcel.driver_earning,
          },
        },
      });

      //? Check for sufficient balance
      if (wallet.balance < 0) {
        throw new ServerError(
          StatusCodes.BAD_REQUEST,
          'Insufficient balance in wallet',
        );
      }

      //? Warn if balance is low (less than $10)
      if (wallet.balance < 10) {
        await NotificationServices.createNotification({
          user_id,
          title: 'Low Wallet Balance',
          message: `Your wallet balance is low ($${wallet.balance.toFixed(2)}). Please top up to continue using our services.`,
          type: 'WARNING',
        });
      }

      //? Record transaction for user
      const transaction = await tx.transaction.create({
        data: {
          user_id,
          amount: parcel.total_cost,
          type: ETransactionType.EXPENSE,
          ref_parcel_id: parcel_id,
          payment_method: 'WALLET',
        },
      });

      //? Record driver income transaction
      await tx.transaction.create({
        data: {
          user_id: parcel.driver_id!,
          amount: parcel.driver_earning,
          type: ETransactionType.INCOME,
          ref_parcel_id: parcel_id,
          payment_method: 'WALLET',
        },
      });

      //? Notify user about payment
      await NotificationServices.createNotification({
        user_id,
        title: 'Payment Successful',
        message: `Payment of $${parcel.total_cost} for parcel delivery completed successfully.`,
        type: 'INFO',
      });

      //? Notify driver about payment received
      await NotificationServices.createNotification({
        user_id: parcel.driver_id!,
        title: 'Payment Received',
        message: `You received $${parcel.total_cost} for the completed parcel delivery.`,
        type: 'INFO',
      });

      //? Emit socket event to driver about trip completion and payment
      await tx.user.update({
        where: { id: parcel.driver_id! },
        data: {
          trip_given_count: {
            increment: 1,
          },
          is_online: true, //? set driver online after trip completion
        },
      });

      //? Emit socket event to driver about trip completion and payment
      await tx.user.update({
        where: { id: user_id },
        data: {
          trip_received_count: {
            increment: 1,
          },
        },
      });

      return { parcel, wallet, transaction };
    });
  },

  async completeParcelDelivery({
    driver_id,
    parcel_id,
  }: TCompleteParcelDeliveryArgs) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });

    if (parcel?.driver_id !== driver_id) {
      throw new ServerError(
        StatusCodes.FORBIDDEN,
        'You are not assigned to this parcel',
      );
    }

    if (parcel.status === EParcelStatus.COMPLETED) {
      return parcel; //? already completed
    }

    if (parcel.status !== EParcelStatus.DELIVERED) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'Parcel is not delivered yet',
      );
    }

    parcel.started_at ??= new Date(); //? fallback
    const completed_at = new Date();

    await NotificationServices.createNotification({
      user_id: parcel.user_id!,
      title: 'Parcel Delivery Completed',
      message: 'Your parcel has been delivered successfully.',
      type: 'INFO',
    });

    return prisma.parcel.update({
      where: { id: parcel_id },
      data: {
        status: EParcelStatus.COMPLETED,
        completed_at,

        //? Calculate total time in milliseconds
        time: completed_at.getTime() - parcel.started_at.getTime(),
      },
      include: {
        user: { omit: userOmit.USER },
        driver: { omit: userOmit.DRIVER },
      },
    });
  },

  /**
   * Get super detailed parcel info for admin
   */
  async getSuperParcelDetails({ parcel_id }: TGetSuperParcelDetailsPayload) {
    return prisma.parcel.findUnique({
      where: { id: parcel_id },
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

  async refundParcel(parcel_id: string) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcel_id },
    });

    if (!parcel) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'Parcel not found');
    }

    if (!parcel.payment_at) {
      return; //? No payment made, so no refund needed
    }

    return prisma.$transaction(async tx => {
      //? Refund user
      await tx.wallet.update({
        where: { id: parcel.user_id! },
        data: {
          balance: {
            increment: parcel.total_cost,
          },
        },
      });

      //? Deduct from driver's wallet
      await tx.wallet.update({
        where: { id: parcel.driver_id! },
        data: {
          balance: {
            decrement: parcel.driver_earning,
          },
        },
      });

      //? Record refund transaction for user
      await tx.transaction.create({
        data: {
          user_id: parcel.user_id!,
          amount: parcel.total_cost,
          type: ETransactionType.BONUS, //? Using BONUS type for refunds
          ref_parcel_id: parcel_id,
          payment_method: 'WALLET',
        },
      });

      //? Record deduction transaction for driver
      await tx.transaction.create({
        data: {
          user_id: parcel.driver_id!,
          amount: parcel.driver_earning,
          type: ETransactionType.EXPENSE, //? Using EXPENSE type for driver deduction
          ref_parcel_id: parcel_id,
          payment_method: 'WALLET',
        },
      });

      //? Update parcel status to refunded
      await tx.parcel.update({
        where: { id: parcel_id },
        data: {
          status: EParcelStatus.CANCELLED,
          payment_at: null,
        },
      });
    });
  },
};
