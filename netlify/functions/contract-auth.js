exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }
  const { password } = body;
  if (!password) return { statusCode: 400, body: JSON.stringify({ error: 'Password required' }) };

  const ownerPw  = process.env.OWNER_DASHBOARD_PASSWORD;
  const clientPw = process.env.CLIENT_CONTRACT_PASSWORD || 'wise1';

  if (password === ownerPw) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'owner',
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_ANON_KEY,
      }),
    };
  }
  if (password === clientPw) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'client' }),
    };
  }
  return { statusCode: 401, body: JSON.stringify({ error: 'Invalid access code' }) };
};
