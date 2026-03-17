import z from 'zod';
import { DriverValidations } from './Driver.validation';
import { TList } from '../query/Query.interface';

export type TSetupDriverProfile = z.infer<
  typeof DriverValidations.setupDriverProfile
>['body'] & { driver_id: string };

export type TSetupVehicle = z.infer<
  typeof DriverValidations.setupVehicle
>['body'] & { driver_id: string };

export type TToggleOnline = z.infer<typeof DriverValidations.toggleOnline> & {
  driver_id: string;
};

export type TRefreshLocation = z.infer<
  typeof DriverValidations.refreshLocation
> & { driver_id: string };

export type TGetEarningsArgs = z.infer<
  typeof DriverValidations.getEarnings
>['query'] & {
  driver_id: string;
} & TList;

/**
 * V2 Types can be added here
 */

/**
 * Type for updating driver location in V2
 */
export type TUpdateDriverLocationV2 = z.infer<
  typeof DriverValidations.updateDriverLocation
>;

/**
 * Type for updating driver location payload in V2
 */
export type TUpdateDriverLocationPayloadV2 = TUpdateDriverLocationV2['body'] & {
  driver_id: string;
};

/**
 * Type for toggling online status in V2
 */
export type TToggleOnlineV2 = z.infer<typeof DriverValidations.toggleOnlineV2>;
