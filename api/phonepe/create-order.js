const crypto = require('crypto');

// In-memory token cache (lasts for the lifetime of the function instance)
let tokenCache = {
  token: null,
  expiresAt: 0
};

const PHONEPE_BASE_URL = process.env.PHONEPE_ENV === 'PRODUCTION'
  ? 'https://api.phonepe.com/apis/pg'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

const PHONEPE_OAUTH_URL = process.env.PHONEPE_ENV === 'PRODUCTION'
  ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  if (tokenCache.token && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  const params = new URLSearchParams();
  params.append('client_id', process.env.PHONEPE_CLIENT_ID);
  params.append('client_secret', process.env.PHONEPE_CLIENT_SECRET);
  params.append('client_version', process.env.PHONEPE_CLIENT_VERSION || '1');
  params.append('grant_type', 'client_credentials');

  const response = await fetch(PHONEPE_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('PhonePe OAuth failed: ' + response.status + ' ' + errorText);
  }

  const data = await response.json();

  tokenCache.token = data.access_token;
  tokenCache.expiresAt = data.expires_at || (now + (data.expires_in || 3600));

  return tokenCache.token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://virtuewisdom.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, email, coupon_code } = req.body || {};

    if (!amount || typeof amount !== 'number' || amount < 100) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const merchantOrderId = 'VW' + Date.now() + crypto.randomBytes(4).toString('hex').toUpperCase();

    const token = await getAccessToken();

    const orderPayload = {
      merchantOrderId: merchantOrderId,
      amount: amount,
      expireAfter: 1200,
      metaInfo: {
        udf1: email,
        udf2: coupon_code || ''
      },
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: 'V&W Brand Strategy Tool',
        merchantUrls: {
          redirectUrl: 'https://virtuewisdom.com/tool/return?orderId=' + merchantOrderId
        }
      }
    };

    const orderResponse = await fetch(PHONEPE_BASE_URL + '/checkout/v2/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'O-Bearer ' + token
      },
      body: JSON.stringify(orderPayload)
    });

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      console.error('PhonePe order creation failed:', orderResponse.status, errorText);
      return res.status(502).json({ error: 'Payment provider error', details: errorText });
    }

    const orderData = await orderResponse.json();

    return res.status(200).json({
      success: true,
      merchantOrderId: merchantOrderId,
      redirectUrl: orderData.redirectUrl,
      orderId: orderData.orderId,
      expireAt: orderData.expireAt
    });

  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};