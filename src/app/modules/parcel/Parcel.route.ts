import purifyRequest from '@/app/middlewares/purifyRequest';
import { Router } from 'express';
import { QueryValidations } from '../query/Query.validation';
import { ParcelControllers } from './Parcel.controller';
import { ParcelValidations } from './Parcel.validation';
import auth from '@/app/middlewares/auth';
import capture from '@/app/middlewares/capture';

const all = Router();
{
  //? Recover last parcel
  all.get('/recover-parcel', auth.all, ParcelControllers.getLastParcel);

  //? Get parcel details
  all.get(
    '/:parcel_id',
    auth.all,
    purifyRequest(QueryValidations.exists('parcel_id', 'parcel')),
    ParcelControllers.getParcelDetails,
  );

  /**
   * Deliver parcel
   */
  all.post(
    '/deliver-parcel',
    auth.driver,
    capture({
      files: {
        fileType: 'images',
        maxCount: 5,
        size: 10 * 1024 * 1024, // 10 MB
      },
    }),
    purifyRequest(ParcelValidations.deliverParcel),
    ParcelControllers.deliverParcel,
  );

  //? Calculate estimated fare
  all.post(
    '/estimate-fare',
    purifyRequest(ParcelValidations.calculateEstimatedFare),
    ParcelControllers.calculateEstimatedFare,
  );

  /**
   * v2 Routes
   */

  /**
   * Request for Parcel v2 Route
   *
   * [user] Request for parcel v2
   */
  all.post(
    '/request-for-parcel',
    auth.user,
    purifyRequest(ParcelValidations.requestForParcelV2),
    ParcelControllers.requestForParcelV2,
  );

  /**
   * Cancel Parcel v2 Route
   *
   * [user] Cancel parcel v2
   */
  all.post(
    '/cancel-parcel',
    auth.user,
    purifyRequest(ParcelValidations.cancelParcelV2),
    ParcelControllers.cancelParcelV2,
  );

  /**
   * Pay for Parcel v2 Route
   *
   * [user] Pay for parcel v2
   */
  all.post(
    '/pay-for-parcel',
    auth.user,
    purifyRequest(ParcelValidations.payForParcelV2),
    ParcelControllers.payForParcelV2,
  );

  /**
   * Driver Parcel v2 Route
   */

  /**
   * Accept Parcel v2 Route
   *
   * [driver] Accept parcel v2
   */
  all.post(
    '/accept-parcel-request',
    auth.driver,
    purifyRequest(ParcelValidations.acceptParcelV2),
    ParcelControllers.acceptParcelV2,
  );

  /**
   * Driver Cancel Parcel v2 Route
   *
   * [driver] Driver cancel parcel v2
   */
  all.post(
    '/cancel-parcel-request',
    auth.driver,
    purifyRequest(ParcelValidations.driverCancelParcelV2),
    ParcelControllers.driverCancelParcelV2,
  );

  /**
   * Start Parcel v2 Route
   *
   * [driver] Start parcel v2
   */
  all.post(
    '/start-parcel',
    auth.driver,
    purifyRequest(ParcelValidations.startParcelV2),
    ParcelControllers.startParcelV2,
  );

  all.post(
    '/deliver-parcel-v2',
    auth.driver,
    capture({
      files: {
        fileType: 'images',
        maxCount: 5,
        size: 10 * 1024 * 1024, // 10 MB
      },
    }),
    purifyRequest(ParcelValidations.deliverParcel),
    ParcelControllers.deliverParcelV2,
  );
}

const admin = Router();
{
  //? Get super detailed parcel info for admin
  admin.get(
    '/:parcel_id',
    purifyRequest(QueryValidations.exists('parcel_id', 'parcel')),
    ParcelControllers.getSuperParcelDetails,
  );
}

export const ParcelRoutes = { all, admin };
