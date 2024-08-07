import Tenant from '../../types/Tenant';
import BackendError from '../../exception/BackendError';
import Constants from '../../utils/Constants';
import DatabaseUtils from './DatabaseUtils';
import Logging from '../../utils/Logging';
import global from '../../types/GlobalType';
import { ObjectId } from 'mongodb';
import WalletTransaction from '../../types/WalletTransaction';

const MODULE_NAME = 'WalletTransactionStorage';

export default class WalletTransactionStorage {
  public static async getTransaction(tenant: Tenant, orderId: string): Promise<WalletTransaction> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    const transactionMDB = await global.database.getCollection<WalletTransaction>(tenant.id, 'wallettransactions')
      .findOne({ _id: orderId });

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getTransaction', startTime, transactionMDB);

    return transactionMDB;
  }

  public static async recordTransaction(tenant: Tenant,orderId: string, userID: string, type: 'credit' | 'debit', amount: number, description: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    const transaction: WalletTransaction = {
      _id: orderId,
      amount,
      description,
      timestamp: new Date(),
      type,
      userID: DatabaseUtils.convertToObjectID(userID),
    };

    const collection = global.database.getCollection<WalletTransaction>(tenant.id, 'wallettransactions');
    if (description !== 'INITIATED') {
      // Find and update the transaction with the given orderId
      const existingTransaction = await WalletTransactionStorage.getTransaction(tenant, orderId);
      if (existingTransaction) {
        await collection.updateOne(
          { _id: orderId },
          { $set: { description: description } }
        );
        console.log('Transaction updated successfully');
      } else {
        // Insert the transaction if it does not exist
        await collection.insertOne(transaction);
        console.log('Transaction inserted successfully');
      }
    } else {
      // Insert the transaction if the description is not 'success'
      await collection.insertOne(transaction);
      console.log('Transaction inserted successfully');
    }

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'recordTransaction', startTime, transaction);
  }

  public static async getTransactionsByUser(tenant: Tenant, userID: string): Promise<WalletTransaction[]> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    const transactions = await global.database.getCollection<WalletTransaction>(tenant.id, 'wallettransactions').find({
      userID: DatabaseUtils.convertToObjectID(userID)
    }).toArray();

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getTransactionsByUser', startTime, { userID });
    return transactions;
  }
}
