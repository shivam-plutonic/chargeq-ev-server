import { ObjectId } from 'mongodb';

export default interface WalletTransaction {
  _id?: string;
  userID: ObjectId;
  type: 'credit' | 'debit';
  amount: number;
  timestamp: Date;
  description?: string;
}
