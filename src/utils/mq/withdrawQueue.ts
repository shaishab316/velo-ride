// import { TWithdrawArgs } from '../../app/modules/payment/Payment.interface';
// import config from '../../config';
// import Queue from 'bull';
// import { prisma } from '../db';
// import ora from 'ora';
// import chalk from 'chalk';
// import { stripe } from '../../app/modules/payment/Payment.utils';
// import { NotificationServices } from '../../app/modules/notification/Notification.service';
// /**
//  * Withdraw queue
//  */
// const withdrawQueue = new Queue<TWithdrawArgs>(
//   `${config.server.name}:withdraws`,
//   config.url.redis,
// );

// withdrawQueue.process(async ({ data }) => {
//   const spinner = ora({
//     color: 'yellow',
//     text: `Withdrawing ${data.amount} from ${data.user.email}`,
//   }).start();

//   const user = await prisma.user.findUnique({
//     where: { id: data.user.id },
//     select: {
//       wallet: {
//         select: {
//           balance: true,
//         },
//       },
//       stripe_account_id: true,
//     },
//   });

//   try {
//     spinner.text = `Checking Stripe account and balance for ${data.user.email}`;

//     if (!user?.stripe_account_id) {
//       throw new Error('Stripe account not found');
//     }

//     //? ensure user has enough balance
//     if (user.wallet!.balance < data.amount) {
//       throw new Error(
//         `Insufficient balance, current balance: ${user.wallet!.balance}, required balance: ${data.amount} ${config.payment.currency}`,
//       );
//     }

//     spinner.text = `Transferring ${data.amount} ${config.payment.currency} to ${data.user.email}`;

//     await stripe.transfers.create({
//       amount: data.amount * 100,
//       currency: config.payment.currency,
//       destination: user.stripe_account_id,
//       description: `Transfer to ${data.user.email}`,
//     });

//     spinner.text = `Retrieving balance for ${data.user.email}`;

//     const balance = (
//       await stripe.balance.retrieve({ stripeAccount: user.stripe_account_id })
//     ).available.find(b => b.currency === config.payment.currency)?.amount;

//     if (!balance) {
//       throw new Error('Transfer failed');
//     }

//     spinner.text = `Payout ${balance / 100} ${config.payment.currency} to ${data.user.email}`;

//     await stripe.payouts.create(
//       { amount: balance, currency: config.payment.currency },
//       { stripeAccount: user.stripe_account_id },
//     );

//     spinner.text = `Updating balance for ${data.user.email}`;

//     await prisma.wallet.updateMany({
//       where: { id: data.user.id },
//       data: { balance: { decrement: data.amount } },
//     });

//     //? Notify user about successful withdrawal
//     await NotificationServices.createNotification({
//       user_id: data.user.id,
//       title: 'Withdrawal Completed',
//       message: `€ ${data.amount} has been successfully withdrawn to your account.`,
//       type: 'INFO',
//     });

//     spinner.succeed(
//       chalk.green(
//         `${data.amount} ${config.payment.currency} withdrawn successfully to ${data.user.email}`,
//       ),
//     );
//   } catch (error) {
//     if (error instanceof Error) {
//       //? Notify user about withdrawal failure
//       await NotificationServices.createNotification({
//         user_id: data.user.id,
//         title: 'Withdrawal Failed',
//         message: `Your withdrawal request of € ${data.amount} failed. ${error.message}`,
//         type: 'ERROR',
//       });

//       spinner.fail(chalk.red(`Withdrawal failed: ${error.message}`));
//     }
//   }
// });

// export default withdrawQueue;
