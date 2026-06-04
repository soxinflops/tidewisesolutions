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

  // Pull capabilities and dedicated bandwidth endpoint in parallel
  let caps = {}, bwData = {};
  if (acct.slug) {
    const [detailRes, bwRes] = await Promise.all([
      fetch(`https://api.netlify.com/api/v1/accounts/${acct.slug}`, { headers: h }),
      fetch(`https://api.netlify.com/api/v1/accounts/${acct.slug}/bandwidth`, { headers: h }),
    ]);
    if (detailRes.ok) caps = (await detailRes.json()).capabilities || {};
    if (bwRes.ok) bwData = await bwRes.json();
  }

  const build = caps.build_minutes     || caps.builds || {};
  const fns   = caps.serverless_exec_seconds || caps.serverless || {};

  // Prefer dedicated /bandwidth endpoint; fall back to capabilities, then site sum
  const bwUsedBytes = bwData.used != null
    ? bwData.used
    : (caps.bandwidth?.used != null
        ? caps.bandwidth.used
        : (Array.isArray(sites) ? sites.reduce((s, x) => s + (x.used_bandwidth || 0), 0) : 0));
  const bwIncludedBytes = bwData.included != null
    ? bwData.included
    : (caps.bandwidth?.included ?? 107374182400); // 100 GB default

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan:              acct.type_name || acct.type || '—',
      site_count:        Array.isArray(sites) ? sites.length : 0,
      bandwidth_used_gb: +(bwUsedBytes / 1e9).toFixed(2),
      bandwidth_limit_gb: +(bwIncludedBytes / 1e9).toFixed(0),
      bandwidth_updated:  bwData.last_updated_at || null,
      period_start:       bwData.period_start_date || null,
      period_end:         bwData.period_end_date || null,
      build_used_min:    build.used   != null ? Math.round(build.used / 60)   : null,
      build_limit_min:   build.included != null ? Math.round(build.included / 60) : null,
      fn_used_sec:       fns.used     != null ? Math.round(fns.used)           : null,
      fn_limit_sec:      fns.included != null ? Math.round(fns.included)       : null,
    }),
  };
};
