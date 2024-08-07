import axios from 'axios';

const CASHFREE_BASE_URL = 'https://sandbox.cashfree.com/pg/orders';
const APP_ID = process.env.APP_ID;
const SECRET_KEY = process.env.SECRET_KEY;

const cashfreeAxios = axios.create({
  baseURL: CASHFREE_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'x-client-id': APP_ID,
    'x-client-secret': SECRET_KEY,
  },
});

export const createCashfreeOrder = async (orderId: string, orderAmount: number, customerEmail: string, customerPhone: string, returnUrl: string, notifyUrl: string) => {
  const data = {
    orderId: orderId,
    orderAmount: orderAmount,
    orderCurrency: 'INR',
    orderNote: 'Recharge Wallet',
    customerDetails: {
      customerEmail: customerEmail,
      customerPhone: customerPhone,
    },
    returnUrl: returnUrl,
    notifyUrl: notifyUrl,
  };

  try {
    console.log(data);
    const response = await cashfreeAxios.post('/orders', data);
    return response.data;
  } catch (error) {
    throw new Error(`Cashfree order creation failed: ${error.message}`);
  }
};
