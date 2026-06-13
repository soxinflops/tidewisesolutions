exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { leadId, password } = body;
  if (!password || password !== process.env.OWNER_DASHBOARD_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (!leadId) return { statusCode: 400, body: JSON.stringify({ error: 'leadId required' }) };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: txt }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
