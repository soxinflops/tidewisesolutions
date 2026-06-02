exports.handler = async () => {
  const token = process.env.NETLIFY_PAT;
  if (!token) return { statusCode: 500, body: JSON.stringify({ error: 'NETLIFY_PAT not set' }) };

  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [acctRes, sitesRes] = await Promise.all([
    fetch('https://api.netlify.com/api/v1/accounts', { headers: h }),
    fetch('https://api.netlify.com/api/v1/sites?per_page=100', { headers: h }),
  ]);

  const accounts = await acctRes.json();
  const sites    = await sitesRes.json();
  const acct     = Array.isArray(accounts) ? accounts[0] : {};

  // Pull capabilities (bandwidth, build minutes, function invocations)
  let caps = {};
  if (acct.slug) {
    const detailRes = await fetch(`https://api.netlify.com/api/v1/accounts/${acct.slug}`, { headers: h });
    if (detailRes.ok) {
      const detail = await detailRes.json();
      caps = detail.capabilities || {};
    }
  }

  console.log('netlify caps keys:', JSON.stringify(Object.keys(caps)));
  const bw    = caps.bandwidth         || {};
  const build = caps.build_minutes     || caps.builds || {};
  const fns   = caps.serverless_exec_seconds || caps.serverless || {};

  // Fallback: sum used_bandwidth across sites if account caps not available
  const bwUsedBytes = bw.used != null
    ? bw.used
    : (Array.isArray(sites) ? sites.reduce((s, x) => s + (x.used_bandwidth || 0), 0) : 0);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan:              acct.type_name || acct.type || '—',
      site_count:        Array.isArray(sites) ? sites.length : 0,
      bandwidth_used_gb: +(bwUsedBytes / 1e9).toFixed(2),
      bandwidth_limit_gb: bw.included != null ? +(bw.included / 1e9).toFixed(0) : 100,
      build_used_min:    build.used   != null ? Math.round(build.used / 60)   : null,
      build_limit_min:   build.included != null ? Math.round(build.included / 60) : null,
      fn_used_sec:       fns.used     != null ? Math.round(fns.used)           : null,
      fn_limit_sec:      fns.included != null ? Math.round(fns.included)       : null,
    }),
  };
};
