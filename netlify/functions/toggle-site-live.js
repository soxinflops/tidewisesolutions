exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { clientId, live, password } = body;
  if (!password || password !== process.env.OWNER_DASHBOARD_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (typeof clientId !== 'string' || !clientId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clientId required' }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tidewise_clients?client_id=eq.${encodeURIComponent(clientId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ site_live: Boolean(live) }),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: txt }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
