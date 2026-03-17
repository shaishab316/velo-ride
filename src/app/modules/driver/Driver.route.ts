import { Router } from 'express';
import purifyRequest from '../../middlewares/purifyRequest';
import { QueryValidations } from '../query/Query.validation';
import { DriverControllers } from './Driver.controller';
import { injectRoutes } from '../../../utils/router/injectRouter';
import { TransactionRoutes } from '../transaction/Transaction.route';
import { DriverValidations } from './Driver.validation';

const admin = Router();
{
  admin.get(
    '/pending',
    purifyRequest(QueryValidations.list),
    DriverControllers.superGetPendingDrivers,
  );

  admin.post(
    '/:driverId/approve',
    purifyRequest(QueryValidations.exists('driverId', 'user')),
    DriverControllers.superApproveDriver,
  );

  admin.post(
    '/:driverId/reject',
    purifyRequest(QueryValidations.exists('driverId', 'user')),
    DriverControllers.superRejectDriver,
  );
}

const driver = injectRoutes(Router(), {
  '/transactions': [TransactionRoutes.driver],
});
{
  /**
   * Driver home route,
   *
   * @returns
   * - total trips count
   * - total earnings
   * - total online time
   */
  driver.get('/', DriverControllers.home);

  /**
   * get driver earnings both trip and parcel
   */
  driver.get(
    '/earnings',
    purifyRequest(QueryValidations.list, DriverValidations.getEarnings),
    DriverControllers.getEarnings,
  );

  /**
   * v2 routes can be added here
   */
  driver.post(
    '/update-location',
    purifyRequest(DriverValidations.updateDriverLocation),
    DriverControllers.updateDriverLocationV2,
  );

  /**
   * Toggle Online Status Route v2
   */
  driver.post(
    '/toggle-online',
    purifyRequest(DriverValidations.toggleOnlineV2),
    DriverControllers.toggleOnlineV2,
  );
}

export const DriverRoutes = { admin, driver };
