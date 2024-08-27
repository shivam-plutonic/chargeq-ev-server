import Tenant from '../../types/Tenant';
import User from '../../types/User';
import Wallet from '../../types/Wallet';
import BackendError from '../../exception/BackendError';
import WalletTransaction from '../../types/WalletTransaction';
import Constants from '../../utils/Constants';
import DatabaseUtils from './DatabaseUtils';
import Logging from '../../utils/Logging';
import global from '../../types/GlobalType';
import { ObjectId } from 'mongodb';
import UserStorage from './UserStorage';
import WalletTransactionStorage from './WalletTransactionStorage';

const MODULE_NAME = 'WalletStorage';

export default class WalletStorage {
  public static async getWalletByMobile(tenant: Tenant, mobile: string = Constants.UNKNOWN_STRING_ID): Promise<User> {
    const userMDB = await UserStorage.getUsers(tenant, {
      mobile : mobile,
    }, Constants.DB_PARAMS_SINGLE_RECORD);
    return userMDB.count === 1 ? userMDB.result[0] : null;
  }

  public static async getWalletBalance(tenant: Tenant, userId: string): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // console.log(tenant, userId, 'getwalletbalance');
    const user = await UserStorage.getUser(tenant, userId);
    // console.log(user);
    if (!user || !user.wallet) {
      throw new BackendError({
        module: MODULE_NAME,
        method: 'getWalletBalance',
        message: 'Wallet not found'
      });
    }
    // console.log(user.wallet.amount, user, 'amount called while checking');

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getWalletBalance', startTime, { userId });
    return user.wallet.amount;
  }

  // public static async getWalletByUserID(tenant: Tenant, userID: string): Promise<User> {
  //   const startTime = Logging.traceDatabaseRequestStart();
  //   DatabaseUtils.checkTenantObject(tenant);
  //   const walletMDB = await global.database.getCollection<User>(tenant.id, 'wallets').findOne({ userID: DatabaseUtils.convertToObjectID(userID) });
  //
  //   await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getWalletByUserID', startTime, { userID });
  //   return walletMDB.wallet;
  // }

  public static async getTransactionsByUserId(
    tenant: Tenant,
    userId: string,
    startDateStr: string | null,
    endDateStr: string | null
  ): Promise<any[]> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    console.log(userId, 'transaction user id');

    // Convert string dates to Date objects
    const startDate = startDateStr ? new Date(startDateStr) : null;
    const endDate = endDateStr ? new Date(endDateStr) : null;

    // Check if the converted dates are valid
    const isValidStartDate = startDate instanceof Date && !isNaN(startDate.getTime());
    const isValidEndDate = endDate instanceof Date && !isNaN(endDate.getTime());

    const filters: any = {
      userID: DatabaseUtils.convertToObjectID(userId)
    };

    // Conditionally add the timestamp filter if both startDate and endDate are valid
    if (isValidStartDate && isValidEndDate) {
      filters.timestamp = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const transactions = await global.database.getCollection<WalletTransaction>(tenant.id, 'wallettransactions')
      .find(filters)
      .toArray();

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getTransactionsByUserId', startTime, { userId });
    return transactions;
  }


  public static async updateNewTransaction(tenant: Tenant, orderId : string, mobile: string, rechargeAmount: any, status: string): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // console.log(tenant);

    const user = await WalletStorage.getWalletByMobile(tenant, mobile);
    if (!user.wallet) {
      throw new BackendError({
        module: MODULE_NAME,
        method: 'updateWalletBalance',
        message: 'Wallet not found'
      });
    }

    const gstRate = 0.18;
    let adjustedAmount = rechargeAmount / (1 + gstRate);
    adjustedAmount = Math.round(adjustedAmount);
    // user.wallet.amount += adjustedAmount;
    // console.log(user.id, user.wallet.amount, 'i d d d d d d d d d d d d ');

    // user.wallet.amount += rechargeAmount;
    // await global.database.getCollection<any>(tenant.id, 'users').findOneAndUpdate(
    //   { '_id': DatabaseUtils.convertToObjectID(user.id) },
    //   { $set: { 'wallet.amount': user.wallet.amount } }
    // );
    await WalletTransactionStorage.recordTransaction(tenant,orderId, user.id, 'credit', adjustedAmount, status);
    // console.log(user.wallet.amount);
    // await UserStorage.saveUserWalletAmount(tenant, user.id, rechargeAmount);
    // console.log(user.id, 'userID');
    // await global.database.getCollection<Wallet>(tenant.id, 'wallets').updateOne(
    //   { userID: DatabaseUtils.convertToObjectID(user.mobile) },
    //   { $set: { balance: user.wallet.amount } }
    // );

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'updateNewTransaction', startTime, { rechargeAmount });
    return user.wallet.amount;
  }

  public static async updateWalletBalance(tenant: Tenant, orderId : string, mobile: string, rechargeAmount: any, status: string): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // console.log(tenant);

    const user = await WalletStorage.getWalletByMobile(tenant, mobile);
    if (!user.wallet) {
      throw new BackendError({
        module: MODULE_NAME,
        method: 'updateWalletBalance',
        message: 'Wallet not found'
      });
    }
    const gstRate = 0.18;
    let adjustedAmount = rechargeAmount / (1 + gstRate);
    adjustedAmount = Math.round(adjustedAmount);
    user.wallet.amount += adjustedAmount;
    // console.log(user.id, user.wallet.amount, 'i d d d d d d d d d d d d ');

    // user.wallet.amount += rechargeAmount;
    await global.database.getCollection<any>(tenant.id, 'users').findOneAndUpdate(
      { '_id': DatabaseUtils.convertToObjectID(user.id) },
      { $set: { 'wallet.amount': user.wallet.amount } }
    );
    await WalletTransactionStorage.recordTransaction(tenant,orderId, user.id, 'credit', adjustedAmount, status);
    console.log(user.wallet.amount);
    // await UserStorage.saveUserWalletAmount(tenant, user.id, rechargeAmount);
    // console.log(user.id, 'userID');
    // await global.database.getCollection<Wallet>(tenant.id, 'wallets').updateOne(
    //   { userID: DatabaseUtils.convertToObjectID(user.mobile) },
    //   { $set: { balance: user.wallet.amount } }
    // );

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'updateWalletBalance', startTime, { rechargeAmount });
    return user.wallet.amount;
  }

  public static async updateWalletBalanceWithdraw(tenant: Tenant, mobile: string, Amount: number): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    const orderId = 'ORID665456' + Date.now();


    const user = await WalletStorage.getWalletByMobile(tenant, mobile);
    if (!user.wallet) {
      throw new BackendError({
        module: MODULE_NAME,
        method: 'updateWalletBalanceWithdraw',
        message: 'Wallet not found'
      });
    }

    // if (user.wallet.amount < Amount) {
    //   throw new BackendError({
    //     module: MODULE_NAME,
    //     method: 'updateWalletBalanceWithdraw',
    //     message: 'Wallet does not have enough amount to pay'
    //   });
    // }

    const gstRate = 0.18;
    let adjustedAmount = Amount / (1 + gstRate);
    adjustedAmount = Math.round(adjustedAmount);
    user.wallet.amount -= Amount;
    await global.database.getCollection<any>(tenant.id, 'users').findOneAndUpdate(
      { '_id': DatabaseUtils.convertToObjectID(user.id) },
      { $set: { 'wallet.amount': user.wallet.amount } }
    );

    await WalletTransactionStorage.recordTransaction(tenant,orderId , user.id, 'debit', Amount, 'SUCCESS');

    // console.log(user.wallet.amount);
    // await UserStorage.saveUserWalletAmount(tenant, user.id, rechargeAmount);
    // console.log(user.id, 'userID');
    // await global.database.getCollection<Wallet>(tenant.id, 'wallets').updateOne(
    //   { userID: DatabaseUtils.convertToObjectID(user.mobile) },
    //   { $set: { balance: user.wallet.amount } }
    // );

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'updateWalletBalanceWithdraw', startTime, { Amount });
    // return user.wallet.amount;
  }

  // public static async createWallet(tenant: Tenant, userID: string, initialBalance: number = 0): Promise<string> {
  //   const startTime = Logging.traceDatabaseRequestStart();
  //   DatabaseUtils.checkTenantObject(tenant);
  //
  //   const wallet = {
  //     _id: new ObjectId(),
  //     userID: DatabaseUtils.convertToObjectID(userID),
  //     balance: initialBalance,
  //     createdOn: new Date(),
  //     lastUpdatedOn: new Date()
  //   };
  //
  //   await global.database.getCollection<Wallet>(tenant.id, 'wallets').insertOne(wallet);
  //
  //   await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'createWallet', startTime, wallet);
  //   return wallet._id.toString();
  // }

  // public static async recordWalletTransaction(tenant: Tenant, userID: string, transaction: WalletTransaction): Promise<void> {
  //   const startTime = Logging.traceDatabaseRequestStart();
  //   DatabaseUtils.checkTenantObject(tenant);
  //
  //   transaction._id = new ObjectId();
  //   transaction.userID = DatabaseUtils.convertToObjectID(userID);
  //   transaction.timestamp = new Date();
  //
  //   await global.database.getCollection<WalletTransaction>(tenant.id, 'wallettransactions').insertOne(transaction);
  //
  //   await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'recordWalletTransaction', startTime, transaction);
  // }
}
