const { createClient } = require('@supabase/supabase-js');

// Initialise Supabase client with service_role key (bypasses RLS)
// Env vars are set in Vercel dashboard, never in code
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // Set CORS headers — allows tool.html and the React app at virtuewisdom.com to call this
  res.setHeader('Access-Control-Allow-Origin', 'https://virtuewisdom.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code } = req.body || {};

    // Validate input
    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        valid: false,
        error: 'Coupon code required'
      });
    }

    // Normalise: uppercase, trim
    const normalised = code.trim().toUpperCase();

    // Look up in database
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('code, discount_type, discount_value, description, active, usage_limit, used_count, expires_at')
      .eq('code', normalised)
      .eq('active', true)
      .single();

    if (error || !coupon) {
      return res.status(200).json({
        valid: false,
        error: 'Coupon not found or inactive'
      });
    }

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(200).json({
        valid: false,
        error: 'Coupon expired'
      });
    }

    // Check usage limit
    if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
      return res.status(200).json({
        valid: false,
        error: 'Coupon usage limit reached'
      });
    }

    // Valid — return discount details
    return res.status(200).json({
      valid: true,
      code: coupon.code,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
      description: coupon.description
    });

  } catch (err) {
    console.error('Coupon validation error:', err);
    return res.status(500).json({
      valid: false,
      error: 'Internal server error'
    });
  }
};
