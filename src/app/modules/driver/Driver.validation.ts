import z from 'zod';
import { enum_encode } from '@/utils/transform/enum';
import { EGender } from '@/utils/db';
import { TModels } from '@/types/db';
import { dateRanges } from '../datetime/Datetime.utils';

/**
 * Shared Validations
 */
const _ = {
  location_type: z.literal('Point').default('Point'),
  location_address: z.string().optional(),

  // Factory functions for location coordinates
  latitude: (fieldName = 'Location') =>
    z.coerce
      .number(`${fieldName} latitude is required`)
      .min(-90, `${fieldName} must be between -90 and 90`)
      .max(90, `${fieldName} must be between -90 and 90`),

  longitude: (fieldName = 'Location') =>
    z.coerce
      .number(`${fieldName} longitude is required`)
      .min(-180, `${fieldName} must be between -180 and 180`)
      .max(180, `${fieldName} must be between -180 and 180`),
};

export const DriverValidations = {
  setupDriverProfile: z.object({
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
      date_of_birth: z.iso.date({
        error: 'Date of birth is required',
      }),
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
      driving_license_photos: z
        .array(
          z
            .string({
              error: 'Driving license is required',
            })
            .nonempty('Driving license is required'),
        )
        .nonempty('Driving license is required'),
    }),
  }),

  setupVehicle: z.object({
    body: z.object({
      vehicle_type: z
        .string({
          error: 'Vehicle type is required',
        })
        .nonempty('Vehicle type is required'),
      vehicle_brand: z
        .string({
          error: 'Vehicle brand is required',
        })
        .nonempty('Vehicle brand is required'),
      vehicle_model: z
        .string({
          error: 'Vehicle model is required',
        })
        .nonempty('Vehicle model is required'),
      vehicle_plate_number: z
        .string({
          error: 'Vehicle plate number is required',
        })
        .nonempty('Vehicle plate number is required'),
      vehicle_registration_photos: z
        .array(
          z
            .string({
              error: 'Vehicle registration photo is required',
            })
            .nonempty('Vehicle registration photo is required'),
        )
        .nonempty('Vehicle registration photo is required'),
      vehicle_photos: z
        .array(
          z
            .string({
              error: 'Vehicle photo is required',
            })
            .nonempty('Vehicle photo is required'),
        )
        .nonempty('Vehicle photo is required'),
    }),
  }),

  getEarnings: z.object({
    query: z.object({
      dateRange: z.enum(dateRanges).optional(),

      //? if custom date range then startDate and endDate are required
      startDate: z.iso.datetime().optional(),
      endDate: z.iso.datetime().optional(),

      //? Model type: trip or parcel to get earnings from
      tab: z.enum(['trip', 'parcel'] satisfies TModels[]).default('trip'),
    }),
  }),

  //! socket
  toggleOnline: z.object({
    online: z.boolean({ error: 'Online status is required' }),
  }),

  refreshLocation: z.object({
    location_type: z.literal('Point').default('Point'),
    location_lat: z.coerce
      .number({ error: 'Location latitude is required' })
      .refine(lat => lat >= -90 && lat <= 90, {
        error: 'Location latitude must be between -90 and 90',
      }),
    location_lng: z.coerce
      .number({ error: 'Location longitude is required' })
      .refine(lng => lng >= -180 && lng <= 180, {
        error: 'Location longitude must be between -180 and 180',
      }),
    location_address: z.string().optional(),
  }),

  /**
   * v2 Validations
   */

  /**
   * Update Driver Location Validation
   */
  updateDriverLocation: z.object({
    body: z.object({
      location_type: _.location_type,
      location_lat: _.latitude('Location'),
      location_lng: _.longitude('Location'),
      location_address: _.location_address,
    }),
  }),

  /**
   * Toggle Online Status Validation v2
   */
  toggleOnlineV2: z.object({
    body: z.object({
      is_online: z.boolean({ error: 'Online status is required' }),
    }),
  }),
};
