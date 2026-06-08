exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { firstName, lastName, businessName, email, phone, businessType, initials, agreedAt } = body;
  if (!firstName || !lastName || !businessName || !email || !phone || !businessType || !initials) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || event.headers['client-ip'] || 'unknown';

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;

  // Generate agreement number: TWS-YYMMDD + 2-digit sequence
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = yy + mm + dd;

  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/signed_contracts?agreement_no=like.TWS-${dateStr}*&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = countRes.ok ? await countRes.json() : [];
  const agreementNo = `TWS-${dateStr}${String(existing.length + 1).padStart(2, '0')}`;

  // Effective date = first of next month
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const effectiveDate = next.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const signedAt = agreedAt || now.toISOString();

  // Insert contract record
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/signed_contracts`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      agreement_no: agreementNo,
      service_type: 'tidewatch',
      first_name: firstName,
      last_name: lastName,
      business_name: businessName,
      email,
      phone,
      business_type: businessType,
      initials,
      ip_address: ip,
      client_agreed_at: signedAt,
      effective_date: effectiveDate,
      status: 'pending_countersign',
    }),
  });

  if (!ins.ok) {
    console.error('Supabase insert error:', await ins.text());
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to log agreement' }) };
  }

  const typeLabel = businessType === 'booking'
    ? 'Recurring Service ($10.00/booking)'
    : 'Project-Based ($20.00/lead)';

  const signedFmt = new Date(signedAt).toLocaleString('en-US', { timeZoneName: 'short' });

  // Email to client — pending confirmation
  if (RESEND_KEY) {
    await Promise.all([
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Tidewise Solutions <contracts@tidewisesolutions.com>',
          to: [email],
          subject: `Agreement Received — ${agreementNo}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:0;">
  <div style="background:#1a6e7e;padding:24px 32px;">
    <h1 style="color:white;margin:0;font-size:20px;letter-spacing:1px;">TIDEWISE SOLUTIONS</h1>
    <p style="color:rgba(255,255,255,0.75);margin:4px 0 0;font-size:13px;">Digital Services Agreement</p>
  </div>
  <div style="padding:32px;">
    <p style="font-size:16px;">Hi ${firstName},</p>
    <p>We've received your signed <strong>TideWatch Digital Services and Licensing Agreement</strong> for <strong>${businessName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;width:160px;border:1px solid #ddd;">Agreement No.</td><td style="padding:8px 12px;border:1px solid #ddd;">${agreementNo}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Business Type</td><td style="padding:8px 12px;border:1px solid #ddd;">${typeLabel}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Effective Date</td><td style="padding:8px 12px;border:1px solid #ddd;">${effectiveDate}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Signed</td><td style="padding:8px 12px;border:1px solid #ddd;">${signedFmt}</td></tr>
    </table>
    <p>Your agreement is currently <strong>pending countersignature</strong> from Tidewise Solutions. Once countersigned, you'll receive a fully executed PDF copy for your records.</p>
    <p>Questions? Reply to this email or reach us at <a href="mailto:neal@tidewisesolutions.com" style="color:#1a6e7e;">neal@tidewisesolutions.com</a>.</p>
  </div>
  <div style="background:#eee;padding:16px 32px;font-size:11px;color:#888;">
    Tidewise Solutions · Brunswick County, North Carolina<br/>
    Agreement No. ${agreementNo} · IP: ${ip}
  </div>
</div>`,
        }),
      }).catch(e => console.error('Resend client email error:', e)),

      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Tidewise Solutions <contracts@tidewisesolutions.com>',
          to: ['neal@tidewisesolutions.com'],
          subject: `New Contract Pending — ${businessName} (${agreementNo})`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#1a6e7e;padding:20px 28px;">
    <h2 style="color:white;margin:0;font-size:16px;">New Contract Pending Countersignature</h2>
  </div>
  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;width:140px;border:1px solid #ddd;">Agreement No.</td><td style="padding:8px 12px;border:1px solid #ddd;"><strong>${agreementNo}</strong></td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Client</td><td style="padding:8px 12px;border:1px solid #ddd;">${firstName} ${lastName}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Business</td><td style="padding:8px 12px;border:1px solid #ddd;">${businessName}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Email</td><td style="padding:8px 12px;border:1px solid #ddd;"><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Phone</td><td style="padding:8px 12px;border:1px solid #ddd;">${phone}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Type</td><td style="padding:8px 12px;border:1px solid #ddd;">${typeLabel}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Effective Date</td><td style="padding:8px 12px;border:1px solid #ddd;">${effectiveDate}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Signed At</td><td style="padding:8px 12px;border:1px solid #ddd;">${signedFmt}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">IP Address</td><td style="padding:8px 12px;border:1px solid #ddd;">${ip}</td></tr>
    </table>
    <p style="margin-top:20px;">Log in to <strong>tidewisesolutions.com/contracts</strong> with your owner password to countersign.</p>
  </div>
</div>`,
        }),
      }).catch(e => console.error('Resend owner email error:', e)),
    ]);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, agreementNo }),
  };
};
