/* eslint-disable no-console */
import { Server } from 'http';
import { Server as IOServer } from 'socket.io';
import config from '../../../config';
import auth from './Socket.middleware';
import { TAuthenticatedSocket } from './Socket.interface';
import { logger } from '../../../utils/logger';
import chalk from 'chalk';
import { prisma } from '../../../utils/db';
import { TripSocket } from '../trip/Trip.socket';
import { ParcelSocket } from '../parcel/Parcel.socket';
import { DriverSocket } from '../driver/Driver.socket';
import { MessageSocket } from '../message/Message.socket';
import { OnlineLogServices } from '../onlineLog/OnlineLog.service';

let io: IOServer | null = null;
const onlineUsers = new Set<string>();

export const SocketServices = {
  init(server: Server): () => void {
    if (io) return this.cleanup;

    io = new IOServer(server, {
      cors: { origin: config.server.allowed_origins },
    });

    logger.info(chalk.green('🚀 Socket services initialized successfully'));

    // Single root namespace only
    io.use(auth);

    io.on('connection', async (socket: TAuthenticatedSocket) => {
      const { user } = socket.data;

      //? Log online status in DB and create online log
      await OnlineLogServices.onlineSessionStart(user.id);

      socket.join(user.id); // join personal room

      this._markOnline(user.id);
      logger.info(`👤 User (${user.name}) connected on /`);

      // errors
      socket.on('error', logger.error);

      if (!io) return;

      // wire up feature handlers
      try {
        TripSocket({ io, socket });
        ParcelSocket({ io, socket });
        DriverSocket({ io, socket });
        MessageSocket({ io, socket });
      } catch (err) {
        logger.error('Root namespace handler error:', err);
      }

      socket.on('disconnect', async () => {
        if (user) {
          await this._markOffline(user.id);
        }

        logger.info(`👤 User (${user.name}) disconnected from /`);
      });
    });

    return this.cleanup;
  },

  emitToUser(userId: string, event: string, payload: any) {
    io?.to(userId).emit(event, payload);
  },

  broadcast(event: string, payload: any) {
    io?.emit(event, payload);
  },

  getIO() {
    return io;
  },

  cleanup() {
    if (!io) return;
    onlineUsers.clear();
    io.close(() => logger.info('Socket.IO server closed.'));
    io = null;
  },

  _markOnline(userId: string) {
    onlineUsers.add(userId);
    this._emitOnline();
  },

  async _markOffline(userId: string) {
    onlineUsers.delete(userId);
    this._emitOnline();

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { is_online: false, last_online_at: new Date() },
        select: { id: true },
      });

      await OnlineLogServices.onlineSessionEnd(userId);
    } catch (error) {
      console.error('Error updating user online status:', error);
    }
  },

  _emitOnline() {
    io?.emit('online_users', Array.from(onlineUsers));
  },
};
