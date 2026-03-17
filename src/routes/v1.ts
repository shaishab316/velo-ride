import { Router } from 'express';
import auth from '@/app/middlewares/auth';
import AdminRoutes from '@/app/modules/admin/Admin.route';
import { AuthRoutes } from '@/app/modules/auth/Auth.route';
import { UserRoutes } from '@/app/modules/user/User.route';
import catchAsync from '@/app/middlewares/catchAsync';
import capture from '@/app/middlewares/capture';
import { PaymentRoutes } from '@/app/modules/payment/Payment.route';
import { TransactionRoutes } from '@/app/modules/transaction/Transaction.route';
import { injectRoutes } from '@/utils/router/injectRouter';
import { ParcelRoutes } from '@/app/modules/parcel/Parcel.route';
import { DriverRoutes } from '@/app/modules/driver/Driver.route';
import { ReviewRoutes } from '@/app/modules/review/Review.route';
import { MessageRoutes } from '@/app/modules/message/Message.route';
import { ChatRoutes } from '@/app/modules/chat/Chat.route';
import { NotificationRoutes } from '@/app/modules/notification/Notification.route';
import { TripRoutes } from '@/app/modules/trip/Trip.route';
import { ContextPageRoutes } from '@/app/modules/contextPage/ContextPage.route';
import { RideHistoryRoutes } from '@/app/modules/rideHistory/RideHistory.route';
import { UserControllers } from '@/app/modules/user/User.controller';

const appRouter = Router();

/**
 * Get user location
 *
 * [GET] /user-location
 */
appRouter.get('/user-location', auth.all, UserControllers.getUserLocationV2);

//? Media upload endpoint
appRouter.post(
  '/upload-media',
  auth.all,
  capture({
    files: {
      size: 100 * 1024 * 1024,
      maxCount: 10,
      fileType: 'any',
    },
  }),
  catchAsync(({ body }) => {
    return {
      message: 'Media uploaded successfully!',
      //? Flatten the uploaded files object
      data: Object.values(body).flat(),
    };
  }),
);

export default injectRoutes(appRouter, {
  // No auth
  '/auth': [AuthRoutes.free],
  '/payments': [PaymentRoutes.free],
  '/context-pages': [ContextPageRoutes.user],
  '/trips': [TripRoutes.all],
  '/parcels': [ParcelRoutes.all],

  // Free auth
  '/profile': [auth.default, UserRoutes.all],
  '/transactions': [auth.default, TransactionRoutes.all],
  '/reviews': [auth.all, ReviewRoutes.all],
  '/inbox': [auth.default, ChatRoutes.all],
  '/messages': [auth.default, MessageRoutes.all],
  '/notifications': [auth.default, NotificationRoutes.all],
  '/ride-history': [auth.default, RideHistoryRoutes.all],

  // Driver auth
  '/drivers': [auth.driver, DriverRoutes.driver],

  // Admin auth
  '/admin': [auth.admin, AdminRoutes],
});
