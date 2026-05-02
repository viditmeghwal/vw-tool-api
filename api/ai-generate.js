module.exports = async (req, res) => {
  const allowedOrigins = ['https://virtuewisdom.com', 'http://localhost:4173', 'http://localhost:5173'];
  const requestOrigin = req.headers.origin;
  if (allowedOrigins.includes(requestOrigin)) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, brand } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid prompt' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return res.status(500).json({ error: 'AI service not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: prompt + '\n\nBrand: ' + (brand || '') }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, data);
      return res.status(response.status).json({ error: data.error?.message || 'AI API error' });
    }

    const text = data.content?.find(b => b.type === 'text')?.text?.trim();
    if (!text) return res.status(502).json({ error: 'Empty response from AI' });

    return res.status(200).json({ text });
  } catch (err) {
    console.error('AI generate error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
