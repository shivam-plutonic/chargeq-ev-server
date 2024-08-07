import HttpByIDRequest from './HttpByIDRequest';
// import HttpDatabaseRequest from './HttpDatabaseRequest';

export interface HttpWalletRechargeRequest extends HttpByIDRequest {
  userID : string,
  amount : number;
}

export interface HttpWalletRechargeUpdate extends HttpByIDRequest {
  userId : string,
  orderId : string;
}

export interface HttpGetWalletBalance {
  id: string
}

export interface HttpGetWalletTransaction {
  userID: string;
  startDate: string;
  endDate: string;
}



