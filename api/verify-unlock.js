const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  const allowedOrigins = ['https://virtuewisdom.com', 'http://localhost:4173', 'http://localhost:5173'];
  const requestOrigin = req.headers.origin;
  if (allowedOrigins.includes(requestOrigin)) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderId, email } = req.body || {};

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({ unlocked: false, error: 'orderId required' });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ unlocked: false, error: 'email required' });
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('merchant_order_id, email, status, unlocked, paid_at')
      .eq('merchant_order_id', orderId)
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !order) {
      return res.status(200).json({ unlocked: false, error: 'Order not found' });
    }

    if (order.status === 'paid' && order.unlocked === true) {
      return res.status(200).json({
        unlocked: true,
        merchantOrderId: order.merchant_order_id,
        paid_at: order.paid_at
      });
    }

    return res.status(200).json({ unlocked: false, status: order.status });

  } catch (err) {
    console.error('Verify unlock error:', err);
    return res.status(500).json({ unlocked: false, error: 'Internal server error' });
  }
};