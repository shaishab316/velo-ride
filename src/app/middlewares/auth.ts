/* eslint-disable no-unused-vars */
import { StatusCodes } from 'http-status-codes';
import ServerError from '@/errors/ServerError';
import { decodeToken, TToken } from '../modules/auth/Auth.utils';
import catchAsync from './catchAsync';
import { EUserRole, prisma, User as TUser } from '@/utils/db';
import config from '@/config';
import { generateOTP } from '@/utils/crypto/otp';
import { sendEmail } from '@/utils/sendMail';
import { emailTemplate } from '@/templates';
import { errorLogger } from '@/utils/logger';

/**
 * Middleware to authenticate and authorize requests based on user roles
 *
 * @param roles - The roles that are allowed to access the resource
 */
const auth = ({
  token_type = 'access_token',
  validators = [],
}: {
  token_type?: TToken;
  validators?: ((user: TUser) => void)[];
} = {}) =>
  catchAsync(async (req, _, next) => {
    const token = req.headers.authorization; //Todo: || req.cookies[token_type];

    const id = decodeToken(token, token_type)?.uid;

    if (!id) {
      throw new ServerError(
        StatusCodes.UNAUTHORIZED,
        'Your session has expired. Login again.',
      );
    }

    const user = await prisma.user.findUnique({
      where: { id, is_deleted: false },
    });

    if (!user) {
      throw new ServerError(
        StatusCodes.UNAUTHORIZED,
        'Maybe your account has been deleted. Register again.',
      );
    }

    await Promise.all(validators.map(fn => fn(user)));

    req.user = user;

    next();
  });

/**
 * Common validator function
 */
export async function commonValidator({
  is_admin,
  is_active,
  is_verified,
  id,
  email,
  name,
  otp_id,
}: TUser) {
  if (is_admin) return;

  if (!is_active) {
    throw new ServerError(
      StatusCodes.FORBIDDEN,
      'Your account is not active, please contact support.',
    );
  }

  if (!is_verified) {
    try {
      const otp = generateOTP({
        tokenType: 'access_token',
        otpId: otp_id.toString(),
      });

      if (email)
        await sendEmail({
          to: email,
          subject: `Your ${config.server.name} Account Verification OTP is ⚡ ${otp} ⚡.`,
          html: emailTemplate({
            userName: name,
            otp,
            template: 'account_verify',
          }),
        });
    } catch (error: any) {
      errorLogger.error(error.message);
    }

    throw new ServerError(
      StatusCodes.FORBIDDEN,
      'Your account is not verified, please verify your email.',
    );
  }
}

// Default auth
auth.default = auth();

// Base auth without role restrictions
auth.all = auth({ validators: [commonValidator] });

//? Auth without "user" role restrictions
auth.allOmitUser = auth({
  validators: [
    commonValidator,
    ({ role }) => {
      if (role === EUserRole.USER) {
        throw new ServerError(
          StatusCodes.FORBIDDEN,
          'You do not have permissions to access this resource',
        );
      }
    },
  ],
});

// Admin auth
auth.admin = auth({
  validators: [
    commonValidator,
    ({ is_admin }) => {
      if (!is_admin) {
        throw new ServerError(StatusCodes.FORBIDDEN, 'You are not an admin');
      }
    },
  ],
});

// Role based auth
Object.values(EUserRole).forEach(role => {
  Object.defineProperty(auth, role.toLowerCase(), {
    value: auth({
      validators: [
        commonValidator,
        user => {
          if (user.role !== role) {
            throw new ServerError(
              StatusCodes.FORBIDDEN,
              `You do not have ${role} permissions`,
            );
          }
        },
      ],
    }),
    enumerable: true,
    configurable: true,
  });
});

// Token based auth
Object.keys(config.jwt).forEach(token_type => {
  Object.defineProperty(auth, token_type, {
    value: auth({ token_type: token_type as TToken }),
    enumerable: true,
    configurable: true,
  });
});

export type TAuth = typeof auth & {
  [K in Lowercase<keyof typeof EUserRole>]: ReturnType<typeof auth>;
} & {
  [K in TToken]: ReturnType<typeof auth>;
};

/**
 * Middleware to authenticate and authorize requests based on user roles
 *
 * @param token_type - The type of token to validate
 * @param validators - Array of validator functions to run on the user
 */
export default auth as TAuth;
