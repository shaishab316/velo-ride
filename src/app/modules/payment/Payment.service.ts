import { StatusCodes } from 'http-status-codes';
import { prisma } from '@/utils/db';
import ServerError from '@/errors/ServerError';
import { TTopup, TWithdrawArgs } from './Payment.interface';
import { UserServices } from '../user/User.service';
import config from '@/config';
import { stripe } from './Payment.utils';
import { NotificationServices } from '../notification/Notification.service';
import chalk from 'chalk';
import ora from 'ora';

/**
 * Payment Services
 */
export const PaymentServices = {
  /**
   * Withdraw money
   *
   * @event withdraw
   */
  async withdraw({ amount, user }: TWithdrawArgs) {
    const wallet = await prisma.wallet.findUnique({
      where: { id: user.id },
    });

    if (!wallet) {
      throw new ServerError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Wallet not found',
      );
    }

    if (wallet.balance < amount) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        "You don't have enough balance",
      );
    }

    if (!user.is_stripe_connected) {
      throw new ServerError(
        StatusCodes.BAD_REQUEST,
        "You haven't connected your Stripe account",
      );
    }

    if (!user.stripe_account_id) {
      await UserServices.stripeAccountConnect({ user_id: user.id });
    }

    const spinner = ora({
      color: 'yellow',
      text: `Withdrawing ${amount} from ${user.email}`,
    }).start();

    try {
      const result = await prisma.$transaction(async tx => {
        spinner.text = `Checking Stripe account and balance for ${user.email}`;

        const userData = await tx.user.findUnique({
          where: { id: user.id },
          select: {
            wallet: {
              select: {
                balance: true,
              },
            },
            stripe_account_id: true,
          },
        });

        if (!userData?.stripe_account_id) {
          throw new ServerError(
            StatusCodes.BAD_REQUEST,
            'Stripe account not connected, please contact support.',
          );
        }

        // Double-check balance with fresh data
        if (userData.wallet!.balance < amount) {
          await NotificationServices.createNotification({
            user_id: user.id,
            title: 'Withdrawal Failed',
            message: `Insufficient balance, current balance: ${userData.wallet!.balance}, required balance: ${amount} ${config.payment.currency}`,
            type: 'ERROR',
          });

          return Promise.reject(
            new ServerError(StatusCodes.BAD_REQUEST, 'Insufficient balance'),
          );
        }

        // Notify user about withdrawal request (at the start)
        await NotificationServices.createNotification({
          user_id: user.id,
          title: 'Withdrawal Request Submitted',
          message: `Your withdrawal request of € ${amount} is being processed.`,
          type: 'INFO',
        });

        // Transfer to connected account
        spinner.text = `Transferring ${amount} ${config.payment.currency} to ${user.email}`;

        await stripe.transfers.create({
          amount: amount * 100,
          currency: config.payment.currency,
          destination: userData.stripe_account_id,
          description: `Transfer to ${user.email}`,
        });

        // Retrieve balance
        spinner.text = `Retrieving balance for ${user.email}`;

        const balance = (
          await stripe.balance.retrieve({
            stripeAccount: userData.stripe_account_id,
          })
        ).available.find(b => b.currency === config.payment.currency)?.amount;

        if (!balance) {
          throw new Error('Transfer failed - balance not available');
        }

        // Create payout
        spinner.text = `Payout ${balance / 100} ${config.payment.currency} to ${user.email}`;

        await stripe.payouts.create(
          {
            amount: balance,
            currency: config.payment.currency,
          },
          {
            stripeAccount: userData.stripe_account_id,
          },
        );

        // Update wallet balance
        spinner.text = `Updating balance for ${user.email}`;

        const updatedWallet = await tx.wallet.update({
          where: { id: user.id },
          data: {
            balance: {
              decrement: amount,
            },
          },
        });

        return updatedWallet;
      });

      // Notify user about successful withdrawal
      await NotificationServices.createNotification({
        user_id: user.id,
        title: 'Withdrawal Completed',
        message: `€ ${amount} has been successfully withdrawn to your account.`,
        type: 'INFO',
      });

      spinner.succeed(
        chalk.green(
          `${amount} ${config.payment.currency} withdrawn successfully to ${user.email}`,
        ),
      );

      return {
        available_balance: result.balance,
      };
    } catch (error) {
      if (error instanceof Error) {
        // Notify user about withdrawal failure
        await NotificationServices.createNotification({
          user_id: user.id,
          title: 'Withdrawal Failed',
          message: `Your withdrawal request of € ${amount} failed. ${error.message}`,
          type: 'ERROR',
        });

        spinner.fail(chalk.red(`Withdrawal failed: ${error.message}`));
      }

      // Re-throw the error so the caller knows it failed
      throw error;
    }
  },

  async topup({ amount, user_id }: TTopup) {
    const { url } = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: config.payment.currency,
            product_data: {
              name: `${config.server.name} Wallet Top-up of € ${amount}`,
              description: 'Add funds to your wallet balance.',
              metadata: {
                type: 'wallet_topup',
              },
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      payment_method_types: config.payment.stripe.methods,
      success_url: `${config.server.name.toLowerCase()}://topup-success?amount=${amount}`,
      cancel_url: `${config.server.name.toLowerCase()}://topup-failure?amount=${amount}`,
      metadata: {
        purpose: 'wallet_topup',
        amount: amount.toString(),
        user_id,
      },
    });

    if (!url)
      throw new ServerError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to create checkout session',
      );

    return url;
  },

  async wallet_topup(session: any) {
    const { amount, user_id } = session.metadata;
    const topupAmount = parseFloat(amount);

    //? Update wallet balance
    await prisma.wallet.update({
      where: { id: user_id },
      data: {
        balance: {
          increment: topupAmount,
        },
      },
    });

    //? Notify user about successful topup
    await NotificationServices.createNotification({
      user_id,
      title: 'Wallet Top-up Successful',
      message: `Your wallet has been topped up with € ${topupAmount}. Happy riding!`,
      type: 'INFO',
    });
  },
};
