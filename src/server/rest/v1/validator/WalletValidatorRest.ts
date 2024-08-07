import { HttpGetWalletBalance, HttpWalletRechargeRequest, HttpWalletRechargeUpdate, HttpGetWalletTransaction } from '../../../../types/requests/HttpWalletRequest';

// import { ChargingProfile } from '../../../../types/ChargingProfile';
import HttpDatabaseRequest from '../../../../types/requests/HttpDatabaseRequest';
import Schema from '../../../../types/validator/Schema';
import SchemaValidator from '../../../../validator/SchemaValidator';
import fs from 'fs';
import global from '../../../../types/GlobalType';

export default class WalletValidatorRest extends SchemaValidator {
  private static instance: WalletValidatorRest | null = null;
  private WalletRecharge: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/wallet/walletrecharge-initiate.json`, 'utf8'));
  private WalletRechargeUpdate: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/wallet/walletrecharge-update.json`, 'utf8'));
  private GetWalletBalance: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/wallet/walletrecharge-get-balance.json`, 'utf8'));
  private GetWalletTransaction: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/wallet/walletrecharge-get-transaction.json`, 'utf8'));

  private constructor() {
    super('WalletValidatorRest');
  }

  public static getInstance(): WalletValidatorRest {
    if (!WalletValidatorRest.instance) {
      WalletValidatorRest.instance = new WalletValidatorRest();
    }
    return WalletValidatorRest.instance;
  }

  public validateWalletRechargeReq(data: Record<string, unknown>): HttpWalletRechargeRequest {
    return this.validate(this.WalletRecharge, data);
  }

  public validateWalletRechargeUpdate(data: Record<string, unknown>): HttpWalletRechargeUpdate {
    return this.validate(this.WalletRechargeUpdate, data);
  }

  public validateWalletBalanceGetReq(data: Record<string, unknown>): HttpGetWalletBalance {
    return this.validate(this.GetWalletBalance, data);
  }

  public validateWalletTransaction(data: Record<string, unknown>): HttpGetWalletTransaction {
    return this.validate(this.GetWalletTransaction, data);
  }
}
