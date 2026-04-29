const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const { merchantOrderId } = req.body || {};

    if (!merchantOrderId || typeof merchantOrderId !== 'string') {
      return res.status(400).json({ error: 'merchantOrderId required' });
    }

    const token = await getAccessToken();

    const statusResponse = await fetch(
      PHONEPE_BASE_URL + '/checkout/v2/order/' + merchantOrderId + '/status',
      {
        method: 'GET',
        headers: { 'Authorization': 'O-Bearer ' + token }
      }
    );

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('PhonePe status check failed:', statusResponse.status, errorText);
      return res.status(502).json({ error: 'Status check failed', details: errorText });
    }

    const statusData = await statusResponse.json();

    let dbStatus = 'pending';
    let unlocked = false;

    if (statusData.state === 'COMPLETED') {
      dbStatus = 'paid';
      unlocked = true;
    } else if (statusData.state === 'FAILED') {
      dbStatus = 'failed';
    }

    const updateData = {
      status: dbStatus,
      unlocked: unlocked,
      metadata: { last_status_check: new Date().toISOString(), phonepe_state: statusData.state },
      updated_at: new Date().toISOString()
    };

    if (dbStatus === 'paid' && statusData.paymentDetails && statusData.paymentDetails[0]) {
      updateData.phonepe_txn_id = statusData.paymentDetails[0].transactionId;
      updateData.paid_at = new Date().toISOString();
    }

    const { data: order, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('merchant_order_id', merchantOrderId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update order:', updateError);
    }

    return res.status(200).json({
      success: true,
      state: statusData.state,
      status: dbStatus,
      unlocked: unlocked,
      merchantOrderId: merchantOrderId
    });

  } catch (err) {
    console.error('Check status error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};