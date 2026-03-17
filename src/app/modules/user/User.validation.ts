import { z } from 'zod';
import { EGender, EUserRole } from '@/utils/db';
import { enum_encode } from '@/utils/transform/enum';
import { date } from '@/utils/transform/date';
import { exists } from '@/utils/db/exists';

export const UserValidations = {
  register: z.object({
    body: z.object({
      email: z.email({ error: 'Email is invalid' }).optional(),
      phone: z.string().optional(),
      role: z.enum(EUserRole).default(EUserRole.USER),
      password: z
        .string({ error: 'Password is missing' })
        .min(6, 'Password must be at least 6 characters long'),
    }),
  }),

  edit: z.object({
    body: z.object({
      email: z.email({ error: 'Email is invalid' }).optional(),
      phone: z.string().optional(),
      role: z.enum(EUserRole).optional(),
      name: z.string().optional(),
      avatar: z.string().optional(),
      nid_number: z.string().optional(),
      payment_method: z.string().optional(),
    }),
  }),

  changePassword: z.object({
    body: z.object({
      oldPassword: z
        .string({
          error: 'Old Password is missing',
        })
        .min(1, 'Old Password is required')
        .min(6, 'Old Password must be at least 6 characters long'),
      newPassword: z
        .string({
          error: 'New Password is missing',
        })
        .min(1, 'New Password is required')
        .min(6, 'New Password must be at least 6 characters long'),
    }),
  }),

  getAllUser: z.object({
    query: z.object({
      role: z.enum(EUserRole).default(EUserRole.USER),
    }),
  }),

  setupUserProfile: z.object({
    body: z.object({
      avatar: z
        .string({
          error: 'Avatar is required',
        })
        .nonempty('Avatar is required'),
      name: z
        .string({
          error: 'Name is required',
        })
        .nonempty('Name is required'),
      date_of_birth: z.union([
        z.string().transform(date).pipe(z.date()),
        z.date(),
      ]),
      gender: z
        .string({
          error: 'Gender is required',
        })
        .transform(enum_encode)
        .pipe(z.enum(EGender)),
      nid_photos: z
        .array(
          z
            .string({
              error: 'NID or Passport is required',
            })
            .nonempty('NID or Passport is required'),
        )
        .nonempty('NID or Passport is required'),
    }),
  }),

  getPendingUsers: z.object({
    query: z.object({
      role: z.enum(EUserRole).default(EUserRole.USER),
    }),
  }),

  pendingUserAction: z.object({
    body: z.object({
      user_id: z.string().refine(exists('user'), {
        error: ({ input }) => `User with id "${input}" does not exist`,
      }),
      action: z.enum(['approve', 'reject']),
    }),
  }),

  deleteUser: z.object({
    body: z.object({
      user_id: z.string().refine(exists('user'), {
        error: ({ input }) => `User with id "${input}" does not exist`,
      }),
    }),
  }),

  onesignalId: z.object({
    body: z.object({
      onesignal_id: z.string().nonempty('OneSignal ID is required'),
    }),
  }),

  /**
   * v2 Validations can be added here
   */
  getUserLocationV2: z.object({
    query: z.object({
      user_id: z.string().refine(exists('user'), {
        error: ({ input }) => `User with id "${input}" does not exist`,
      }),
    }),
  }),
};
