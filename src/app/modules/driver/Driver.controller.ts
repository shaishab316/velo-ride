import catchAsync from '../../middlewares/catchAsync';
import { SocketServices } from '../socket/Socket.service';
import type {
  TGetEarningsArgs,
  TToggleOnlineV2,
  TUpdateDriverLocationV2,
} from './Driver.interface';
import { DriverServices } from './Driver.service';
import { User as TUser } from '@/utils/db';

export const DriverControllers = {
  superGetPendingDrivers: catchAsync(async ({ query }) => {
    const { meta, users } = await DriverServices.superGetPendingDriver(query);

    return {
      message: 'Pending drivers retrieved successfully!',
      meta,
      data: users,
    };
  }),

  superApproveDriver: catchAsync(async ({ params }) => {
    const data = await DriverServices.superApproveDriver(params.driverId);

    return {
      message: 'Driver approved successfully!',
      data,
    };
  }),

  superRejectDriver: catchAsync(async ({ params }) => {
    const data = await DriverServices.superRejectDriver(params.driverId);

    return {
      message: 'Driver rejected successfully!',
      data,
    };
  }),

  setupDriverProfile: catchAsync(async ({ body, user }) => {
    const data = await DriverServices.setupDriverProfile({
      ...body,
      driver_id: user.id,
    });

    return {
      message: 'Driver Profile setup successfully!',
      data,
    };
  }),

  setupVehicle: catchAsync(async ({ body, user }) => {
    const data = await DriverServices.setupVehicle({
      ...body,
      driver_id: user.id,
    });

    return {
      message: 'Vehicle setup successfully!',
      data,
    };
  }),

  getEarnings: catchAsync(
    async ({ query, user }: { query: TGetEarningsArgs; user: TUser }) => {
      const { meta, data } = await DriverServices[`${query.tab}Earnings`]({
        ...query,
        driver_id: user.id,
      });

      return {
        message: 'Driver earnings retrieved successfully!',
        meta,
        data,
      };
    },
  ),

  home: catchAsync(async ({ user: driver }) => {
    const data = await DriverServices.home({ driver_id: driver.id });

    return {
      message: 'Driver home data retrieved successfully!',
      data,
    };
  }),

  /**
   * V2 Controllers can be added here
   */
  updateDriverLocationV2: catchAsync<TUpdateDriverLocationV2>(
    async ({ user: driver, body: payload }) => {
      await DriverServices.updateDriverLocationV2({
        ...payload,
        driver_id: driver.id,
      });

      //? Emit location update to interested parties
      SocketServices.broadcast(`location::${driver.id}`, payload);

      return {
        message: 'Location updated successfully!',
        data: payload,
      };
    },
  ),

  /**
   * Toggle Online Status Controller v2
   */
  toggleOnlineV2: catchAsync<TToggleOnlineV2>(
    async ({ body: payload, user: driver }) => {
      const data = await DriverServices.toggleOnline({
        driver_id: driver.id,
        online: payload.is_online,
      });

      return {
        message: 'Online status updated successfully!',
        data,
      };
    },
  ),
};
