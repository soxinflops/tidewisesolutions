exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { password, clientId } = body;
  if (!password || !clientId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
  if (password !== process.env.OWNER_DASHBOARD_PASSWORD) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tidewise_clients?client_id=eq.${encodeURIComponent(clientId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error('Delete error:', txt);
    return { statusCode: 500, body: JSON.stringify({ error: 'Delete failed' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
