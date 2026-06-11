exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
  }
  if (!body.password || body.password !== process.env.OWNER_DASHBOARD_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid password' }) };
  }

  // Sign into Supabase Auth as owner — returns a real authenticated session
  const authRes = await fetch(
    `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: process.env.SUPABASE_OWNER_EMAIL,
        // NOTE: the Netlify env var is misspelled "OWNE" (no R). It holds the
        // correct Supabase owner-account password, so we read it as-is rather
        // than recreating the var. Fix the env var name later if convenient.
        password: process.env.SUPABASE_OWNE_PASSWORD,
      }),
    }
  );
  const session = await authRes.json();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    }),
  };
};
