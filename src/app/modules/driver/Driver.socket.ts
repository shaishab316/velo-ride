import { TSocketHandler } from '../socket/Socket.interface';
import { SocketServices } from '../socket/Socket.service';
import { catchAsyncSocket } from '../socket/Socket.utils';
import { DriverServices } from './Driver.service';
import { DriverValidations } from './Driver.validation';

export const DriverSocket: TSocketHandler = async ({ socket }) => {
  const driver = socket.data.user;

  // const processingParcel = await ParcelServices.getProcessingDriverParcel({
  //   driver_id: driver.id,
  // });

  // if (processingParcel) {
  //   socket.emit('parcel:request', processingParcel);
  // }

  socket.on(
    'driver:toggle_online',
    catchAsyncSocket(async ({ online }) => {
      const data = await DriverServices.toggleOnline({
        driver_id: driver.id,
        online,
      });

      return data;
    }, DriverValidations.toggleOnline),
  );

  socket.on(
    'driver:refresh_location',
    catchAsyncSocket(async payload => {
      await DriverServices.refreshLocation({
        ...payload,
        driver_id: driver.id,
      });

      return payload;
    }, DriverValidations.refreshLocation),
  );

  socket.on(
    'driver:update_location',
    catchAsyncSocket(async payload => {
      await DriverServices.updateDriverLocationV2({
        ...payload,
        driver_id: driver.id,
      });

      //? Emit location update to interested parties
      SocketServices.broadcast(`location::${driver.id}`, payload);

      return payload;
    }, DriverValidations.refreshLocation),
  );
};
