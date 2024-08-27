import path from 'path';
import UserStorage from '../../../../storage/mongodb/UserStorage';
import { Action, Entity } from '../../../../types/Authorization';
import { NextFunction, Request, Response } from 'express';
import global from '../../../../types/GlobalType';
import Tenant, { TenantComponents } from '../../../../types/Tenant';
import WalletValidatorRest from '../validator/WalletValidatorRest';
import WalletStorage from '../../../../storage/mongodb/WalletStorage';

import AppError from '../../../../exception/AppError';
import AuthorizationService from './AuthorizationService';
// import Authorizations from '../../../../authorization/Authorizations';
// import Constants from '../../../../utils/Constants';
import { HTTPError } from '../../../../types/HTTPError';
import Logging from '../../../../utils/Logging';
// import LoggingHelper from '../../../../utils/LoggingHelper';
import { ServerAction } from '../../../../types/Server';
// import { StatusCodes } from 'http-status-codes';
// import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';
// import { CFPaymentGateway } from 'cashfree-pg-sdk-nodejs';
import { createCashfreeOrder } from './CreateCashFreeService';
import axios from 'axios';
const MODULE_NAME = 'WalletService';


export default class WalletService {

  public static async handleWalletRecharge(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {

    const filteredRequest = WalletValidatorRest.getInstance().validateWalletRechargeReq(req.query);
    const id = filteredRequest.userID as string;
    const amount = filteredRequest.amount as number;
    const orderId = 'ORID665456' + Date.now();
    console.log(req.tenant, 'tenant');
    const tenantName = req.tenant.subdomain;
    const user = await UserStorage.getUser(req.tenant, id);
    void WalletStorage.updateNewTransaction(req.tenant, orderId, user.mobile , amount, 'INITIATED');

    // if (rechargeAmount <= 0) {
    //   throw new AppError({
    //     errorCode: HTTPError.INVALID_CAPTCHA,
    //     message: 'Recharge amount must be greater than zero',
    //     user: req.user,
    //     module: MODULE_NAME,
    //     method: 'handleWalletRecharge'
    //   });
    //
    // }
    try {
      const options = {
        method: 'post',
        url: 'https://sandbox.cashfree.com/pg/orders',
        headers: {
          accept: 'application/json',
          'x-api-version': ' 2025-01-01',
          'content-type': 'application/json',
          'x-client-id': process.env.CASHFREE_CLIENT_ID,
          'x-client-secret': process.env.CASHFREE_CLIENT_SECRET
        },
        data: {
          customer_details: {
            customer_id: id,
            customer_email: user.email,
            customer_phone: user.mobile,
            customer_name: user.firstName,
          },
          order_meta: {
            return_url: `https://${tenantName}.chargeq.energy/users/wallet#balance/{order_id}`,
          },
          order_amount: amount,
          order_id: orderId,
          order_currency: 'INR',
        }
      };

      await Logging.logInfo({
        tenantID: req.tenant.id,
        user: req.user,
        module: MODULE_NAME,
        method: 'handleWalletRecharge',
        message: 'Wallet recharge order created successfully',
        action: action,
      });
      axios.request(options).then(function(response) {
        // res.json({ response });
        res.json(response.data.payment_session_id);
      })
        .catch(function(error) {
          // console.error(error);
        });
    } catch (error) {
      res.status(500).send({
        message: error.message,
        success:false
      });
    }
  }


  public static async checkTransactionStatus(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {

    const filteredRequest = WalletValidatorRest.getInstance().validateWalletRechargeUpdate(req.query);
    const orderId = filteredRequest.orderId as string;
    const id = filteredRequest.userId as string;
    const user = await UserStorage.getUser(req.tenant, id);
    const mobile = user.mobile;
    let url = `https://sandbox.cashfree.com/pg/orders/${orderId}`;
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      url = `https://sandbox.cashfree.com/pg/orders/${orderId}`;
    }
    // else if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development-build') {
    //
    // }

    try {
      const options = {
        method: 'get',
        url: url,
        headers: {
          accept: 'application/json',
          'x-api-version': '2025-01-01',
          'content-type': 'application/json',
          'x-client-id': process.env.CASHFREE_CLIENT_ID,
          'x-client-secret': process.env.CASHFREE_CLIENT_SECRET
        }
      };
      axios.request(options).then(function(response) {
        // console.log(response.data);
        const paymentStatus = response.data;
        if (paymentStatus.order_status !== 'PAID') {
          void Logging.logInfo({
            'tenantID': req.tenant.id,
            'user': req.user,
            'module': MODULE_NAME,
            'method': 'checkTransactionStatus',
            'message': 'Wallet recharge Failed',
            'action': action,
            'detailedMessages': { paymentStatus }
          });
          void WalletStorage.updateNewTransaction(req.tenant, orderId, mobile , response.data.order_amount, 'FAILED');
          throw new AppError({
            errorCode: HTTPError.GENERAL_ERROR,
            message: 'Payment not completed or failed',
            user: req.user,
            module: MODULE_NAME,
            method: 'handlePaymentStatus'
          });
        } else if (response.data.order_status === 'PAID') {
          const amount = response.data.order_amount;
          void Logging.logInfo({
            'tenantID': req.tenant.id,
            'user': req.user,
            'module': MODULE_NAME,
            'method': 'checkTransactionStatus',
            'message': `Wallet recharge of ${amount} units successful`,
            'action': action,
            'detailedMessages': { paymentStatus }
          });
          void WalletStorage.updateWalletBalance(req.tenant, orderId, mobile , amount, 'SUCCESS');
          // res.json(walletBalance);
        }
      })
        .catch(function(error) {
          res.status(500).send({
            message: error.message,
            success: false
          });
        });
    } catch (error) {
      res.status(500).send({
        message: error.message,
        success: false
      });
    }
  }


  public static async handleGetWalletBalance(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.WALLET,
    //   Action.READ, Entity.WALLET, MODULE_NAME, 'handleGetWalletBalance');
    // Filter
    const filteredRequest = WalletValidatorRest.getInstance().validateWalletBalanceGetReq(req.query);

    // Retrieve wallet balance for the user
    const walletBalance = await WalletStorage.getWalletBalance(req.tenant, filteredRequest.id);
    await Logging.logInfo({
      tenantID: req.tenant.id,
      user: req.user,
      module: MODULE_NAME,
      method: 'handleGetWalletBalance',
      message: 'Get Wallet balance called Successfully',
      action: action,
      detailedMessages: { walletBalance }
    });
    res.json({ balance: walletBalance });
    // console.log(res.json);
    next();
  }

  // public static async handleWalletRecharge(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
  //   // Check if component is active
  //   // UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.WALLET,
  //   //   Action.CREATE, Entity.WALLET, MODULE_NAME, 'handleWalletRecharge');
  //   // Filter
  //   // const filteredRequest = WalletValidatorRest.getInstance().validateWalletRechargeReq(req.body);
  //   const filteredRequest = req.body;
  //   // Check auth
  //   // await AuthorizationService.checkAndGetWalletAuthorizations(
  //   //   req.tenant, req.user, Action.CREATE);
  //   // Perform the wallet recharge
  //   const rechargeAmount = filteredRequest.amount;
  //   if (rechargeAmount <= 0) {
  //     throw new AppError({
  //       errorCode: HTTPError.INVALID_CAPTCHA,
  //       message: 'Recharge amount must be greater than zero',
  //       user: req.user,
  //       module: MODULE_NAME,
  //       method: 'handleWalletRecharge'
  //     });
  //   }
  //   // Simulate recharge process
  //   console.log(filteredRequest.mobile, rechargeAmount);
  //   const walletBalance = await WalletStorage.updateWalletBalance(req.tenant, filteredRequest.mobile, rechargeAmount);
  //   // Log the recharge action
  //   await Logging.logInfo({
  //     tenantID: req.tenant.id,
  //     user: req.user,
  //     module: MODULE_NAME,
  //     method: 'handleWalletRecharge',
  //     message: `Wallet recharge of ${rechargeAmount} units successful`,
  //     action: action,
  //     detailedMessages: { rechargeAmount }
  //   });
  //   res.json({ balance: walletBalance });
  //   next();
  // }

  public static async handleWalletWithdraw(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    // UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.WALLET,
    //   Action.CREATE, Entity.WALLET, MODULE_NAME, 'handleWalletRecharge');
    // Filter
    // const filteredRequest = WalletValidatorRest.getInstance().validateWalletRechargeReq(req.body);
    const filteredRequest = req.body;
    // Check auth
    // await AuthorizationService.checkAndGetWalletAuthorizations(
    //   req.tenant, req.user, Action.CREATE);
    // Perform the wallet recharge
    const rechargeAmount = filteredRequest.amount;
    if (rechargeAmount <= 0) {
      throw new AppError({
        errorCode: HTTPError.INVALID_CAPTCHA,
        message: 'Recharge amount must be greater than zero',
        user: req.user,
        module: MODULE_NAME,
        method: 'handleWalletRecharge'
      });
    }
    // Simulate recharge process
    console.log(filteredRequest.mobile, rechargeAmount);
    const walletBalance = await WalletStorage.updateWalletBalanceWithdraw(req.tenant, filteredRequest.mobile, rechargeAmount);
    // Log the recharge action
    await Logging.logInfo({
      tenantID: req.tenant.id,
      user: req.user,
      module: MODULE_NAME,
      method: 'handleWalletRecharge',
      message: `Wallet recharge of ${rechargeAmount} units successful`,
      action: action,
      detailedMessages: { rechargeAmount }
    });
    res.json({ balance: walletBalance });
    next();
  }

  public static async handleGetWalletTransactions(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {

    const filteredRequest = WalletValidatorRest.getInstance().validateWalletTransaction(req.query);
    const transactions = await WalletStorage.getTransactionsByUserId(req.tenant, filteredRequest.userID, filteredRequest.startDate, filteredRequest.endDate);
    await Logging.logInfo({
      tenantID: req.tenant.id,
      user: req.user,
      module: MODULE_NAME,
      method: 'handleGetWalletTransactions',
      message: 'Get Wallet transactions successful',
      action: action,
    });
    // Respond with transactions
    // console.log(transactions,'TRANSACTIONS');
    res.json(transactions);
    next();
  }
}
