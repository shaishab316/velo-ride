import type z from 'zod';
import { ParcelValidations } from './Parcel.validation';

export type TRequestForParcel = z.infer<
  typeof ParcelValidations.requestForParcel
> & { user_id: string };

export type TGetNearestDriver = {
  pickup_lat: number;
  pickup_lng: number;
};

export type TParcelRefreshLocation = z.infer<
  typeof ParcelValidations.refreshLocation
>;

export type TStartParcelArgs = {
  driver_id: string;
  parcel_id: string;
};

export type TCompleteParcelDeliveryArgs = {
  driver_id: string;
  parcel_id: string;
};

export type TDeliverParcelBody = z.infer<
  typeof ParcelValidations.deliverParcel
>['body'];

export type TDeliverParcel = {
  body: TDeliverParcelBody;
};

export type TDeliverParcelArgs = TDeliverParcelBody & { driver_id: string };

export type TGetSuperParcelDetailsParams = {
  parcel_id: string;
};

export type TGetSuperParcelDetailsPayload = TGetSuperParcelDetailsParams;

export type TGetSuperParcelDetails = {
  params: TGetSuperParcelDetailsParams;
};

/**
 * V2 Types
 */

/**
 * request for parcel v2
 */
export type TRequestForParcelV2 = z.infer<
  typeof ParcelValidations.requestForParcelV2
>;

/**
 * cancel parcel v2
 */
export type TCancelParcelV2 = z.infer<typeof ParcelValidations.cancelParcelV2>;

/**
 * pay for parcel v2
 */
export type TPayForParcelV2 = z.infer<typeof ParcelValidations.payForParcelV2>;

/**
 * accept parcel v2
 */
export type TAcceptParcelV2 = z.infer<typeof ParcelValidations.acceptParcelV2>;

/**
 * driver cancel parcel v2
 */
export type TDriverCancelParcelV2 = z.infer<
  typeof ParcelValidations.driverCancelParcelV2
>;

/**
 * start parcel v2
 */
export type TStartParcelV2 = z.infer<typeof ParcelValidations.startParcelV2>;

/**
 * complete parcel delivery v2
 */
export type TCompleteParcelDeliveryV2 = z.infer<
  typeof ParcelValidations.completeParcelDeliveryV2
>;
