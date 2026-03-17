import {
  userSearchableFields as searchFields,
  userOmit,
  userSelfOmit,
} from './User.constant';
import { type Prisma, prisma, User as TUser } from '@/utils/db';
import type { TPagination } from '@/utils/server/serveResponse';
import type {
  TDeleteUser,
  TGetAllUser,
  TGetPendingUsers,
  TGetUserLocationPayloadV2,
  TPendingUserAction,
  TSetupUserProfile,
  TUpdateOneSignalId,
  TUserEdit,
  TUserRegister,
} from './User.interface';
import ServerError from '@/errors/ServerError';
import { StatusCodes } from 'http-status-codes';
import { AuthServices } from '../auth/Auth.service';
import { hashPassword } from '../auth/Auth.utils';
import { deleteFiles } from '@/app/middlewares/capture';
import { stripe } from '../payment/Payment.utils';
import ora from 'ora';
import chalk from 'chalk';
import { NotificationServices } from '../notification/Notification.service';
// import { generateOTP } from '@/utils/crypto/otp';
// import { sendEmail } from '@/utils/sendMail';
// import config from '@/config';
// import { emailTemplate } from '@/templates';
import { errorLogger } from '@/utils/logger';
import { sendEmail } from '@/utils/sendMail';
import { emailTemplate } from '@/templates';
import config from '@/config';

export const UserServices = {
  async userRegister({ password, email, phone, role }: TUserRegister) {
    AuthServices.validEmailORPhone({ email, phone });

    //! check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });

    if (existingUser?.is_verified) {
      if (existingUser.is_deleted) {
        throw new ServerError(
          StatusCodes.GONE,
          'This account has been permanently deleted. Please contact support if you believe this is a mistake.',
        );
      }

      if (!existingUser.is_active) {
        throw new ServerError(
          StatusCodes.FORBIDDEN,
          'This email is already registered, but the account is pending admin approval. You will be notified once it is activated.',
        );
      }

      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'You already have an active account with this email. Please sign in.',
      );
    }

    //! finally create user and in return omit auth fields
    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: await hashPassword(password),
        role,
        is_verified: true,
      },
      omit: userSelfOmit[role],
    });

    //? create wallet for user
    await prisma.wallet.create({
      data: { id: user.id },
    });

    await this.stripeAccountConnect({ user_id: user.id });

    // try {
    //   const otp = generateOTP({
    //     tokenType: 'access_token',
    //     otpId: user.id + 1,
    //   });

    //   if (email)
    //     await sendEmail({
    //       to: email,
    //       subject: `Your ${config.server.name} Account Verification OTP is ⚡ ${otp} ⚡.`,
    //       html: emailTemplate({
    //         userName: user.name,
    //         otp,
    //         template: 'account_verify',
    //       }),
    //     });
    // } catch (error: any) {
    //   errorLogger.error(error.message);
    // }

    //? Send welcome notification
    await NotificationServices.createNotification({
      user_id: user.id,
      title: 'Welcome to Pathao!',
      message:
        'Thank you for registering. Your account has been created successfully.',
      type: 'INFO',
    });

    return user;
  },

  async updateUser({ user, body }: { user: Partial<TUser>; body: TUserEdit }) {
    if (body.phone || body.email) {
      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email: body.email }, { phone: body.phone }] },
        select: { id: true, email: true, phone: true },
      });

      if (existingUser && existingUser.id !== user.id) {
        throw new ServerError(
          StatusCodes.CONFLICT,
          `User already exists with this ${existingUser.email ? 'email' : ''} ${existingUser.phone ? 'phone' : ''}`.trim(),
        );
      }
    }

    body.avatar ||= undefined;
    if (body.avatar && user?.avatar) await deleteFiles([user.avatar]);

    return prisma.user.update({
      where: { id: user.id },
      omit: userOmit[body.role ?? user.role!],
      data: body,
    });
  },

  async getAllUser({ page, limit, search, role }: TGetAllUser) {
    const where: Prisma.UserWhereInput = {
      role,
      is_deleted: false,
    };

    if (search)
      where.OR = searchFields.map(field => ({
        [field]: {
          contains: search,
          mode: 'insensitive',
        },
      }));

    const users = await prisma.user.findMany({
      where,
      omit: userSelfOmit[role],
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.user.count({ where });

    return {
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        } as TPagination,
      },
      users,
    };
  },

  async getUserById({
    userId,
    omit = undefined,
  }: {
    userId: string;
    omit?: Prisma.UserOmit;
  }) {
    return prisma.user.findUnique({
      where: { id: userId },
      omit,
    });
  },

  async getUsersCount() {
    const counts = await prisma.user.groupBy({
      by: ['role'],
      _count: {
        _all: true,
      },
    });

    return Object.fromEntries(
      counts.map(({ role, _count }) => [role, _count._all]),
    );
  },

  async deleteAccount({ user_id }: TDeleteUser) {
    const user = await prisma.user.findUnique({ where: { id: user_id } });

    if (user?.avatar) await deleteFiles([user.avatar]);

    return prisma.user.delete({
      where: { id: user_id },
      omit: userSelfOmit[user!.role],
    });
  },

  async setupUserProfile({
    avatar,
    date_of_birth,
    gender,
    name,
    nid_photos,
    user_id,
  }: TSetupUserProfile) {
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });

    // Clean up old files
    if (user?.avatar) await deleteFiles([user.avatar]);
    if (user?.nid_photos) await deleteFiles(user.nid_photos);

    return prisma.user.update({
      where: { id: user_id },
      data: {
        avatar,
        date_of_birth,
        gender,
        name,
        nid_photos,

        is_verification_pending: true,
      },
      omit: userSelfOmit.USER,
    });
  },

  async getPendingUsers({ limit, page, search, role }: TGetPendingUsers) {
    const where: Prisma.UserWhereInput = {
      OR: [
        { is_verification_pending: true },
        { is_active: false },
        { is_verified: false },
      ],
      role,
    };

    if (search) {
      where.OR = searchFields.map(field => ({
        [field]: {
          contains: search,
          mode: 'insensitive',
        },
      }));
    }

    const users = await prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      omit: {
        ...userSelfOmit[role],
        capture_avatar: false, //? allow capture avatar for admin review
      },
    });

    const total = await prisma.user.count({
      where,
    });

    return {
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        } satisfies TPagination,
      },
      users,
    };
  },

  //?? Admin Actions
  async pendingUserAction({ action, user_id }: TPendingUserAction) {
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'User not found');
    }

    await NotificationServices.createNotification({
      user_id: user.id,
      title: action === 'approve' ? 'Account Approved' : 'Account Rejected',
      message:
        action === 'approve'
          ? 'Your account has been approved. You can now log in and start using our services.'
          : 'Your account verification has been rejected. Please contact support for further assistance.',
      type: 'INFO',
    });

    if (action === 'approve') {
      const data = await prisma.user.update({
        where: { id: user_id },
        data: {
          is_verification_pending: false,
          is_active: true,
          is_verified: true,
        },
        omit: userSelfOmit.USER,
      });

      if (data.email) {
        await sendEmail({
          to: data.email,
          subject: `Your ${config.server.name} Account has been Approved!`,
          html: emailTemplate({
            userName: data.name,
            template: 'account_approved',
            otp: '',
          }),
        });
      }

      return data;
    } else {
      const data = this.deleteAccount({ user_id });

      if (user.email) {
        await sendEmail({
          to: user.email,
          subject: `Your ${config.server.name} Account has been Rejected`,
          html: emailTemplate({
            userName: user.name,
            template: 'account_rejected',
            otp: '',
          }),
        });
      }

      return data;
    }
  },

  async uploadCaptureAvatar({
    avatar,
    user_id,
  }: {
    user_id: string;
    avatar: string;
  }) {
    if (!avatar) {
      throw new ServerError(StatusCodes.BAD_REQUEST, 'Avatar is required');
    }

    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });

    if (user?.capture_avatar) await deleteFiles([user.capture_avatar]);

    return prisma.user.update({
      where: { id: user_id },
      data: {
        capture_avatar: avatar,
        is_verification_pending: true,
      },
      omit: userSelfOmit[user!.role],
    });
  },

  async onesignalIdUpdate({ onesignal_id, user_id }: TUpdateOneSignalId) {
    await prisma.user.update({
      where: { id: user_id },
      data: {
        onesignal_id,
      },
    });
  },

  async stripeAccountConnect({ user_id }: { user_id: string }) {
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      select: {
        stripe_account_id: true,
        email: true,
      },
    });

    if (user && !user.stripe_account_id) {
      const spinner = ora({
        color: 'yellow',
        text: `Checking Stripe account for ${user.email}`,
      }).start();

      try {
        const stripeAccount = await stripe.accounts.create({
          type: 'express',
          email: user.email ?? undefined,
          capabilities: {
            transfers: { requested: true },
          },
        });

        await prisma.user.update({
          where: { id: user_id },
          data: { stripe_account_id: stripeAccount.id },
        });

        spinner.succeed(`Stripe account created for ${user.email}`);
      } catch (error) {
        spinner.fail(`Failed creating Stripe account for ${user.email}`);

        errorLogger.error(
          chalk.red(`Error creating Stripe account for ${user.email}`),
          error,
        );
      }
    }
  },

  /**
   * v2 Services can be added here
   */
  async getUserLocationV2({ user_id }: TGetUserLocationPayloadV2) {
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      select: {
        location_lat: true,
        location_lng: true,
        location_address: true,
        location_type: true,
      },
    });

    if (!user) {
      throw new ServerError(StatusCodes.NOT_FOUND, 'User not found');
    }

    return user;
  },
};
