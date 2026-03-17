import ServerError from '@/errors/ServerError';
import { prisma } from '@/utils/db';
import { StatusCodes } from 'http-status-codes';

/**
 * Service for handling online log related operations, such as calculating total online time for users.
 */
export const OnlineLogServices = {
  /**
   * Get today's total online time for a driver in seconds
   *
   * @returns Total online time in seconds
   */
  async getTodayOnlineTime(user_id: string) {
    //? Get current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    const sessions = await prisma.onlineLog.findMany({
      where: {
        user_id,
        data: new Date(today),
      },
      select: {
        online_seconds: true,
        started_at: true,
        ended_at: true,
      },
    });

    return sessions.reduce((acc, session) => {
      let onlineTime = session.online_seconds ?? 0;

      if (!session.ended_at) {
        onlineTime = this.calculateOnlineTime(session.started_at, new Date());
      }

      return acc + onlineTime;
    }, 0);
  },

  /**
   * Calculate online time in seconds between two timestamps
   *
   * @returns Online time in seconds
   */
  calculateOnlineTime(started_at: Date, ended_at: Date) {
    const started = started_at.getTime();
    const ended = ended_at.getTime();

    if (ended < started) {
      throw new ServerError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'ended_at cannot be before started_at',
      );
    }

    return ((ended - started) / 1000) | 0;
  },

  /**
   * Start a new online session for a user by creating an online log entry with the current timestamp as started_at.
   */
  async onlineSessionStart(user_id: string) {
    await prisma.onlineLog.create({
      data: {
        user_id,
        started_at: new Date(),
        data: new Date(),
      },
    });
  },

  /**
   * End the active online session for a user by updating the corresponding online log entry with ended_at and calculating online_seconds.
   */
  async onlineSessionEnd(user_id: string) {
    const lastOnlineLog = await prisma.onlineLog.findFirst({
      where: {
        user_id,
        ended_at: null, //? Only fetch active session
      },
      orderBy: { started_at: 'desc' },
    });

    //? If user has an active online log, update it with ended_at and online_seconds
    if (lastOnlineLog) {
      const ended_at = new Date();

      await prisma.onlineLog.update({
        where: { id: lastOnlineLog.id },
        data: {
          ended_at,
          online_seconds: OnlineLogServices.calculateOnlineTime(
            lastOnlineLog.started_at,
            ended_at,
          ),
        },
      });
    }
  },
};
