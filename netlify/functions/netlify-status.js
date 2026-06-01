exports.handler = async () => {
  const token = process.env.NETLIFY_PAT;
  if (!token) return { statusCode: 500, body: JSON.stringify({ error: 'NETLIFY_PAT not set' }) };

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [acctRes, sitesRes] = await Promise.all([
    fetch('https://api.netlify.com/api/v1/accounts', { headers }),
    fetch('https://api.netlify.com/api/v1/sites?per_page=100', { headers }),
  ]);

  const accounts = await acctRes.json();
  const sites    = await sitesRes.json();

  const acct = Array.isArray(accounts) ? accounts[0] : {};
  const bwBytes = Array.isArray(sites)
    ? sites.reduce((sum, s) => sum + (s.used_bandwidth || 0), 0)
    : 0;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_name: acct.name || '—',
      plan:         acct.type_name || acct.type || '—',
      bandwidth_gb: +(bwBytes / 1e9).toFixed(2),
      limit_gb:     100,
      site_count:   Array.isArray(sites) ? sites.length : 0,
    }),
  };
};
