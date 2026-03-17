import { UserServices } from './User.service';
import catchAsync from '../../middlewares/catchAsync';
import { StatusCodes } from 'http-status-codes';
import { AuthServices } from '../auth/Auth.service';
import { prisma, User as TUser } from '@/utils/db';
import { enum_decode } from '@/utils/transform/enum';
import { capitalize } from '@/utils/transform/capitalize';
import { userSelfOmit } from './User.constant';
import ServerError from '@/errors/ServerError';
import { stripe } from '../payment/Payment.utils';
import config from '@/config';
import { TGetUserLocationV2 } from './User.interface';

export const UserControllers = {
  register: catchAsync(async ({ body }, res) => {
    const user = await UserServices.userRegister(body);

    const { access_token, refresh_token } = AuthServices.retrieveToken(
      user.id,
      'access_token',
      'refresh_token',
    );

    AuthServices.setTokens(res, { access_token, refresh_token });

    return {
      track_activity: user.id,
      statusCode: StatusCodes.CREATED,
      message: `${capitalize(user.role) ?? 'Unknown'} registered successfully!`,
      data: {
        access_token,
        refresh_token,
        user,
      },
    };
  }),

  editProfile: catchAsync(async req => {
    const data = await UserServices.updateUser(req);

    return {
      track_activity: req.user.id,
      message: 'Profile updated successfully!',
      data,
    };
  }),

  superEditProfile: catchAsync(async ({ params, body }) => {
    const user = (await prisma.user.findUnique({
      where: { id: params.user_id },
    })) as TUser;

    const data = await UserServices.updateUser({
      user,
      body,
    });

    return {
      message: `${capitalize(user?.role) ?? 'User'} updated successfully!`,
      data,
    };
  }),

  getAllUser: catchAsync(async ({ query }) => {
    const { meta, users } = await UserServices.getAllUser(query);

    Object.assign(meta, {
      users: await UserServices.getUsersCount(),
    });

    return {
      message: 'Users retrieved successfully!',
      meta,
      data: users,
    };
  }),

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  profile: catchAsync(async ({ user }) => {
    return {
      message: 'Profile retrieved successfully!',
      data: await prisma.user.findUnique({
        where: { id: user.id },
        omit: userSelfOmit[user.role],
        include: {
          wallet: {
            omit: {
              id: true,
            },
          },
        },
      }),
    };
  }),

  superDeleteAccount: catchAsync(async ({ body }) => {
    const user = await UserServices.deleteAccount(body);

    return {
      track_activity: user.id,
      message: `${user?.name ?? 'User'} deleted successfully!`,
    };
  }),

  deleteAccount: catchAsync(async ({ user }) => {
    await UserServices.deleteAccount({ user_id: user.id });

    return {
      track_activity: user.id,
      message: `Goodbye ${user?.name ?? enum_decode(user.role)}! Your account has been deleted successfully!`,
    };
  }),

  setupUserProfile: catchAsync(async ({ body, user }) => {
    const data = await UserServices.setupUserProfile({
      ...body,
      user_id: user.id,
    });

    return {
      message: 'Profile setup successfully!',
      data,
    };
  }),

  getPendingUsers: catchAsync(async ({ query }) => {
    const { meta, users } = await UserServices.getPendingUsers(query);

    return {
      message: 'Pending users retrieved successfully!',
      meta,
      data: users,
    };
  }),

  pendingUserAction: catchAsync(async ({ body }) => {
    const data = await UserServices.pendingUserAction(body);

    return {
      message: `User has been ${body.action === 'approve' ? 'approved' : 'rejected'} successfully!`,
      data,
    };
  }),

  /**
   *
   */
  connectStripeAccount: catchAsync(async ({ user }) => {
    if (!user.stripe_account_id) {
      await UserServices.stripeAccountConnect({ user_id: user.id });
    }

    if (user.is_stripe_connected) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'Stripe account already connected',
      );
    }

    if (!user.stripe_account_id) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        'Your Stripe account is not set up yet, please contact support.',
      );
    }

    const { url } = await stripe.accountLinks.create({
      account: user.stripe_account_id,
      refresh_url: `${config.url.href}/not-found`,
      return_url: `${config.url.href}/payments/stripe/connect?user_id=${user.id}`,
      type: 'account_onboarding',
    });

    return {
      message: 'Stripe connect link created successfully!',
      data: {
        url,
      },
    };
  }),

  uploadCaptureAvatar: catchAsync(async ({ user, body }) => {
    const data = await UserServices.uploadCaptureAvatar({
      user_id: user.id,
      ...body,
    });

    return {
      track_activity: user.id,
      message: 'Capture avatar uploaded successfully!',
      data,
    };
  }),

  onesignalIdUpdate: catchAsync(async ({ body, user }) => {
    await UserServices.onesignalIdUpdate({
      ...body,
      user_id: user.id,
    });

    return {
      message: 'OneSignal ID updated successfully!',
    };
  }),

  /**
   * v2 Controllers can be added here
   */
  getUserLocationV2: catchAsync<TGetUserLocationV2>(async ({ query }) => {
    const data = await UserServices.getUserLocationV2(query);

    return {
      message: 'User location retrieved successfully!',
      data,
    };
  }),
};
