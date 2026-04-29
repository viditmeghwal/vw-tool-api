const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const { code, email } = req.body || {};

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Coupon code required' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const normalised = code.trim().toUpperCase();

    const { data: coupon, error: lookupError } = await supabase
      .from('coupons')
      .select('id, code, discount_type, discount_value, active, usage_limit, used_count, expires_at')
      .eq('code', normalised)
      .eq('active', true)
      .single();

    if (lookupError || !coupon) {
      return res.status(400).json({ valid: false, error: 'Coupon not found or inactive' });
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ valid: false, error: 'Coupon expired' });
    }

    if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
      return res.status(400).json({ valid: false, error: 'Coupon usage limit reached' });
    }

    if (coupon.discount_type !== 'percent' || coupon.discount_value !== 100) {
      return res.status(400).json({
        valid: false,
        error: 'This coupon does not provide free unlock. Use it at checkout instead.'
      });
    }

    const merchantOrderId = 'VW' + Date.now() + crypto.randomBytes(4).toString('hex').toUpperCase();

    const { data: order, error: insertError } = await supabase
      .from('orders')
      .insert({
        email: email,
        amount_paid: 0,
        currency: 'INR',
        merchant_order_id: merchantOrderId,
        coupon_code: normalised,
        status: 'paid',
        unlocked: true,
        paid_at: new Date().toISOString(),
        metadata: { source: 'coupon-100-percent', coupon_id: coupon.id }
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to save coupon order:', insertError);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    await supabase
      .from('coupons')
      .update({ used_count: coupon.used_count + 1 })
      .eq('id', coupon.id);

    return res.status(200).json({
      success: true,
      unlocked: true,
      merchantOrderId: merchantOrderId,
      coupon_code: normalised,
      message: 'Unlocked via coupon'
    });

  } catch (err) {
    console.error('Unlock with coupon error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};