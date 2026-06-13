exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { contractId, ownerPassword } = body;
  if (ownerPassword !== process.env.OWNER_DASHBOARD_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (!contractId) return { statusCode: 400, body: JSON.stringify({ error: 'contractId required' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;

  // Fetch the contract
  const cRes = await fetch(
    `${SUPABASE_URL}/rest/v1/signed_contracts?id=eq.${contractId}&select=*&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!cRes.ok) return { statusCode: 500, body: JSON.stringify({ error: 'DB error' }) };
  const contracts = await cRes.json();
  if (!contracts.length) return { statusCode: 404, body: JSON.stringify({ error: 'Contract not found' }) };
  const c = contracts[0];
  if (c.status === 'executed') return { statusCode: 400, body: JSON.stringify({ error: 'Already executed' }) };

  const nealSignedAt = new Date().toISOString();

  // Generate client slug from business name initials
  const slug = generateSlug(c.business_name);
  const slugFinal = await uniqueSlug(slug, SUPABASE_URL, SUPABASE_KEY);

  // Generate PDF
  const pdfBuffer = await generateContractPDF({ ...c, neal_signed_at: nealSignedAt });
  const pdfBase64 = pdfBuffer.toString('base64');
  const filename = `TideWatch-Agreement-${c.agreement_no}.pdf`;

  // Update contract to executed
  await fetch(`${SUPABASE_URL}/rest/v1/signed_contracts?id=eq.${contractId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status: 'executed', neal_signed_at: nealSignedAt, client_id: slugFinal }),
  });

  // Create tidewise_clients record
  await fetch(`${SUPABASE_URL}/rest/v1/tidewise_clients`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      name: c.business_name,
      client_id: slugFinal,
      email: c.email,
      lead_type: c.business_type === 'booking' ? 'booking' : 'project',
      tier: 'safe-harbor',
      setup_collected: true,
      site_live: false,
    }),
  });

  const typeLabel = c.business_type === 'booking'
    ? 'Recurring Service ($10.00/booking)'
    : 'Project-Based ($20.00/lead)';
  const signedFmt = new Date(nealSignedAt).toLocaleString('en-US', { timeZoneName: 'short' });

  // Email executed PDF to both parties
  if (RESEND_KEY) {
    const attachment = { filename, content: pdfBase64 };

    await Promise.all([
      // To client
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Tidewise Solutions <contracts@tidewisesolutions.com>',
          to: [c.email],
          subject: `Fully Executed Agreement — ${c.agreement_no}`,
          attachments: [attachment],
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#1a6e7e;padding:24px 32px;">
    <h1 style="color:white;margin:0;font-size:20px;letter-spacing:1px;">TIDEWISE SOLUTIONS</h1>
    <p style="color:rgba(255,255,255,0.75);margin:4px 0 0;font-size:13px;">Digital Services Agreement — Fully Executed</p>
  </div>
  <div style="padding:32px;">
    <p style="font-size:16px;">Hi ${c.first_name},</p>
    <p>Your <strong>TideWatch Digital Services and Licensing Agreement</strong> is now <strong style="color:#1a6e7e;">fully executed</strong>. Both parties have signed.</p>
    <p>Your executed agreement (${c.agreement_no}) is attached to this email as a PDF. Please keep it for your records.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;width:160px;border:1px solid #ddd;">Agreement No.</td><td style="padding:8px 12px;border:1px solid #ddd;">${c.agreement_no}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Business</td><td style="padding:8px 12px;border:1px solid #ddd;">${c.business_name}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Service Type</td><td style="padding:8px 12px;border:1px solid #ddd;">${typeLabel}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Effective Date</td><td style="padding:8px 12px;border:1px solid #ddd;">${c.effective_date}</td></tr>
      <tr><td style="padding:8px 12px;background:#f0f4f5;font-weight:bold;border:1px solid #ddd;">Countersigned</td><td style="padding:8px 12px;border:1px solid #ddd;">${signedFmt}</td></tr>
    </table>
    <p>We're excited to get started. We'll be in touch shortly about next steps.</p>
    <p>— Jonathan Hughes, Tidewise Solutions<br/>
    <a href="mailto:neal@tidewisesolutions.com" style="color:#1a6e7e;">neal@tidewisesolutions.com</a> · 910-880-1900</p>
  </div>
  <div style="background:#eee;padding:16px 32px;font-size:11px;color:#888;">
    Tidewise Solutions · Brunswick County, North Carolina · © 2026
  </div>
</div>`,
        }),
      }).catch(e => console.error('Resend client exec email error:', e)),

      // To Neal
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Tidewise Solutions <contracts@tidewisesolutions.com>',
          to: ['neal@tidewisesolutions.com'],
          subject: `Executed — ${c.business_name} (${c.agreement_no})`,
          attachments: [attachment],
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;">
  <div style="background:#1a6e7e;padding:20px 28px;">
    <h2 style="color:white;margin:0;font-size:16px;">Agreement Fully Executed ✓</h2>
  </div>
  <div style="padding:24px;">
    <p><strong>${c.business_name}</strong> — ${c.agreement_no}</p>
    <p>Client: ${c.first_name} ${c.last_name} · ${c.email}<br/>
    Type: ${typeLabel}<br/>
    Effective: ${c.effective_date}<br/>
    Client ID (slug): <code>${slugFinal}</code></p>
    <p>Executed PDF is attached. Client card created in Command Center.</p>
  </div>
</div>`,
        }),
      }).catch(e => console.error('Resend neal exec email error:', e)),
    ]);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, pdf: pdfBase64, filename, clientId: slugFinal }),
  };
};

// ── Slug helpers ────────────────────────────────────────────────────────────

function generateSlug(businessName) {
  const initials = businessName
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w[0].toLowerCase())
    .join('');
  return initials || businessName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'client';
}

async function uniqueSlug(base, supabaseUrl, key) {
  let candidate = base;
  let i = 2;
  while (true) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/tidewise_clients?client_id=eq.${candidate}&select=id&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const rows = res.ok ? await res.json() : [];
    if (!rows.length) return candidate;
    candidate = base + i++;
  }
}

// ── PDF generation ──────────────────────────────────────────────────────────

function generateContractPDF(c) {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    const chunks = [];
    doc.on('data', b => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 72;
    const W = 468;
    const col2X = M + W / 2 + 8;
    const halfW = W / 2 - 8;

    const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZoneName: 'short' });

    const hr = () => {
      doc.moveDown(0.3).moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.5).strokeColor('#999').stroke()
         .strokeColor('#000').lineWidth(1).moveDown(0.3);
    };
    const sHead = (n, t) => {
      doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10).fillColor('#000').text(`${n}. ${t.toUpperCase()}`).moveDown(0.2);
    };
    const sub = (n, t, body) => {
      doc.moveDown(0.2).font('Helvetica-Bold').fontSize(9).text(`${n} ${t}. `, { continued: true });
      doc.font('Helvetica').text(body, { align: 'justify' }).moveDown(0.2);
    };
    const para = (t) => doc.font('Helvetica').fontSize(9).text(t, { align: 'justify' }).moveDown(0.35);
    const gp = (label, body) => {
      doc.font('Helvetica-Bold').fontSize(9).text(`${label}. `, { continued: true });
      doc.font('Helvetica').text(body, { align: 'justify' }).moveDown(0.2);
    };

    // ── PAGE 1 ──────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a6e7e').text('TIDEWISE SOLUTIONS', { align: 'center' });
    doc.fillColor('#000').font('Helvetica').fontSize(13).text('Digital Services and Licensing Agreement', { align: 'center' }).moveDown(0.5);
    hr();

    doc.font('Helvetica').fontSize(9);
    const y0 = doc.y;
    doc.text(`Agreement No.: ${c.agreement_no}`, M, y0);
    doc.text(`Date: ${fmtDate(c.client_agreed_at)}`, M + W / 2, y0, { width: W / 2, align: 'right' });
    doc.y = y0 + 14; doc.x = M;
    doc.text(`Effective Date: ${c.effective_date}`).moveDown(0.5);
    hr();

    // Parties
    const pY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a6e7e').text('CLIENT', M, pY);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(`${c.first_name} ${c.last_name}`, M, pY + 14);
    doc.font('Helvetica').fontSize(9).text(`d/b/a ${c.business_name}`, M, pY + 28);
    doc.fillColor('#555').fontSize(8).text('hereinafter referred to as "Client"', M, pY + 42);

    doc.fillColor('#1a6e7e').font('Helvetica-Bold').fontSize(8).text('SERVICE PROVIDER', col2X, pY);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('Jonathan Hughes', col2X, pY + 14);
    doc.font('Helvetica').fontSize(9).text('d/b/a Tidewise Solutions', col2X, pY + 28);
    doc.fillColor('#555').fontSize(8).text('hereinafter referred to as "Tidewise"', col2X, pY + 42);
    doc.text('Brunswick County, North Carolina', col2X, pY + 54);

    doc.fillColor('#000'); doc.y = pY + 72; doc.x = M;
    doc.moveDown(0.5);
    hr();

    // Business type designation
    doc.font('Helvetica').fontSize(9).text('Client Business Type Designation (initial one):').moveDown(0.2);
    const isBooking = c.business_type === 'booking';
    doc.text(`${isBooking ? c.initials : '_____'}   Recurring Service Business (calendar booking form on website)`).moveDown(0.1);
    doc.text(`${!isBooking ? c.initials : '_____'}   Project-Based Business (estimate request form on website)`).moveDown(0.2);
    doc.fillColor('#555').fontSize(8).text('Designation locked at signing. Governs per-lead fee structure per Fee Schedule.').fillColor('#000').moveDown(0.4);
    hr();

    doc.font('Helvetica').fontSize(9).text('The Parties agree as follows:').moveDown(0.5);

    // ── SECTIONS ────────────────────────────────────────────────────────────
    sHead('1', 'NATURE OF THIS AGREEMENT');
    para('Tidewise shall design, develop, and deploy digital assets on behalf of Client, including but not limited to a website, domain registration, branded email, and associated digital infrastructure (collectively, the "Digital Assets"). Tidewise shall further provide ongoing digital marketing and web management services during the term of this Agreement.');
    para('This Agreement governs the ownership, licensing, use, compensation, and termination terms applicable to those services and assets. It is not a guarantee of any specific business outcome. Tidewise\'s obligation is to deliver qualified leads and maintain Client\'s digital presence in good faith. Results are subject to market conditions and factors outside Tidewise\'s control.');

    sHead('2', 'OWNERSHIP OF DIGITAL ASSETS');
    para('All Digital Assets created, developed, or procured by Tidewise under this Agreement remain the sole and exclusive intellectual property of Tidewise Solutions at all times, unless ownership is formally transferred pursuant to Section 6.');
    para('Client\'s right to use the Digital Assets during the term of this Agreement constitutes a limited, non-exclusive, revocable license only. This license is contingent upon Client remaining in good standing and terminates automatically upon expiration or termination of this Agreement, unless a buyout or transfer has been completed in accordance with Section 6.');
    para('Client shall not transfer, sublicense, sell, or otherwise convey any rights in the Digital Assets to any third party without the prior written consent of Tidewise.');

    sHead('3', 'COMPENSATION AND FEE STRUCTURE');
    sub('3.1', 'Setup Fee', 'A one-time, non-refundable setup fee is due upon execution of this Agreement. No work shall commence prior to receipt of said fee.');
    sub('3.2', 'Per-Lead Performance Fee', 'Throughout the term of this Agreement, Client shall pay a per-lead performance fee for each Qualified Lead delivered through the Digital Assets. The applicable fee is determined by Client\'s Business Type Designation as set forth in the Fee Schedule. A Qualified Lead is defined as a verified customer inquiry or booking that is: (a) CAPTCHA-authenticated; (b) confirmed non-duplicative; and (c) not successfully disputed by Client through the Client Dashboard within thirty (30) days of delivery.');
    sub('3.3', 'Lead Validity Independent of Conversion', 'Per-Lead Performance Fees are assessed upon verified delivery of a Qualified Lead to Client. Fees are not contingent upon Client\'s ability to close, convert, schedule, retain, or complete service for the prospective customer. Disputes shall be limited to challenges regarding the legitimacy of the lead itself (e.g., bot submissions, duplicates, fraudulent inquiries).');
    sub('3.4', 'Monthly Retainer', 'Following the Safe Harbor Period defined in Section 4, Client shall pay a monthly retainer fee. The applicable retainer tier is determined by Client\'s monthly Qualified Lead volume in accordance with the tier structure set forth in the Fee Schedule.');
    sub('3.5', 'Fee Schedule', 'All specific fee amounts, retainer tiers, per-lead rates, and tier thresholds are governed exclusively by the Tidewise Solutions Fee Schedule in effect at the time of signing, which has been provided to and initialed by Client as a separate document.');

    doc.moveDown(0.3).font('Helvetica-Bold').fontSize(9).text('Fee Schedule Acknowledgment').moveDown(0.2);
    doc.font('Helvetica').fontSize(9).text(`Client confirms receipt of the Tidewise Solutions Fee Schedule dated: ${fmtDate(c.client_agreed_at)}`).moveDown(0.1);
    doc.text(`Client Initials: ${c.initials}     Tidewise Initials: JH`).moveDown(0.4);

    sHead('4', 'THE SAFE HARBOR PERIOD');
    para('The first ninety (90) days of this Agreement, calculated in full calendar months beginning on the first day of the month following the Effective Date, constitute the "Safe Harbor Period." During this period, no monthly retainer is assessed. Client\'s sole recurring financial obligation is the per-lead performance fee for each Qualified Lead delivered.');
    para('Upon conclusion of the Safe Harbor Period, Tidewise shall conduct a Key Performance Indicator audit. Client\'s Qualified Lead volume during the Safe Harbor Period shall determine Client\'s initial retainer tier. Client then enters the one-year Retainer Period defined in Section 5.');
    para('Client may dispute any lead charge by submitting a dispute through the Client Dashboard within thirty (30) days of the lead\'s appearance therein. Leads confirmed by Tidewise as non-qualifying shall be removed from Client\'s invoice without charge.');

    sHead('5', 'THE RETAINER PERIOD AND TIER STRUCTURE');
    sub('5.1', 'Term', 'The Retainer Period commences upon conclusion of the Safe Harbor Period and continues for twelve (12) calendar months.');
    sub('5.2', 'Tier Advancement', 'Client\'s retainer tier shall be subject to upward adjustment when Client\'s Qualified Lead volume in any single calendar month meets or exceeds the lower threshold of the next tier as defined in the Fee Schedule. Tier advancement takes effect on the first day of the billing cycle immediately following the qualifying month.');
    sub('5.3', 'Tier Floor', 'Once Client has been assigned to or advanced to a given tier, Client\'s monthly retainer obligation shall not be reduced below that tier for any reason, including a subsequent decline in lead volume. The tier floor reflects Tidewise\'s sustained investment in Client\'s digital infrastructure and ongoing market presence.');
    sub('5.4', 'Re-Evaluation Cadence', 'Tidewise shall conduct performance re-evaluations every ninety (90) days throughout the Retainer Period for tier advancement assessment only.');

    sHead('6', 'TERMINATION AND DIGITAL ASSET OWNERSHIP UPON EXIT');
    sub('6.1', 'At Conclusion of the Safe Harbor Period', 'If Client elects not to continue into the Retainer Period, all outstanding per-lead fees remain due. The Digital Assets remain the property of Tidewise. Client may acquire the Digital Assets, including the domain, by remitting the Buyout Fee within fifteen (15) days. If Client declines, Tidewise retains all Digital Assets with no further obligation on either Party.');
    sub('6.2', 'Early Termination by Client During the Retainer Period', 'Should Client terminate this Agreement prior to expiration of the Retainer Period: (a) the full monthly retainer for the termination month is due regardless of date; (b) an Early Termination Fee equal to three (3) months of Client\'s then-current retainer tier is due; (c) the Buyout Fee is due if Client elects to retain the Digital Assets. The Early Termination Fee represents a reasonable pre-estimate of damages and is not a penalty.');
    sub('6.3', 'Termination by Tidewise During the Retainer Period', 'Tidewise reserves the right to terminate this Agreement at any time upon written notice. Upon Tidewise-initiated termination: (a) Client owes fifty percent (50%) of the monthly retainer if termination occurs on or before the 15th of the month, or the full monthly retainer if after the 15th; (b) no Early Termination Fee is assessed against Client; (c) the Buyout Fee applies if Client elects to retain the Digital Assets.');
    sub('6.4', 'Expiration Upon Completion of the Full Retainer Period', 'Upon completion of the full twelve-month Retainer Period, if either Party elects not to renew, no Early Termination Fee applies. Ownership of the Digital Assets, including the domain, transfers to Client upon payment of the Transfer Fee as specified in the Fee Schedule. Domain transfer shall be effectuated at the next registration renewal date.');
    sub('6.5', 'The Buyout Fee', 'The Buyout Fee, as specified in the Fee Schedule, is the fixed price at which Client may acquire the Digital Assets upon exit prior to completion of the full Retainer Period. This fee applies regardless of which Party initiates termination. Tidewise reserves the right to waive or reduce this fee at its sole discretion.');
    sub('6.6', 'The Transfer Fee', 'Upon successful completion of the full twelve-month Retainer Period, Client may elect to retain the Digital Assets by remitting the Transfer Fee as specified in the Fee Schedule. This fee covers the administrative cost of domain transfer and credential handoff. Tidewise reserves the right to waive this fee at its sole discretion.');

    sHead('7', 'INVOICING, PAYMENT, AND DEFAULT');
    sub('7.1', 'Invoicing', 'Tidewise shall issue invoices monthly to Client\'s email address on file. Invoices are due upon receipt.');
    sub('7.2', 'Payment Timeline', 'Payment not received by Day 10 following invoice issuance is considered past due. Three (3) or more past due payment events within a single contract year constitute grounds for termination at Tidewise\'s discretion. A late fee of $10.00 per calendar day accrues beginning Day 15. A second notice is issued on Day 20. On Day 30, a formal Notice of Default is issued and services may be suspended. A second default event within the same contract year results in automatic termination.');
    sub('7.3', 'Termination Balances', 'All fees arising from termination are due within ten (10) days of the termination date. The same $10.00 per day late fee applies beginning Day 11. Mandatory mediation shall be initiated on Day 30 if the balance remains unresolved.');
    sub('7.4', 'Mandatory Mediation', 'Prior to initiation of any legal proceedings, the Parties agree to attempt good faith mediation in Brunswick County, North Carolina. For standard invoices, mediation shall be initiated no earlier than Day 45 following invoice issuance.');
    sub('7.5', 'Hardship', 'Client may request a hardship review in writing prior to an invoice\'s due date. At Tidewise\'s sole discretion, late fees may be waived, reduced, or suspended, and services may be temporarily paused. This accommodation may be granted no more than once per contract year.');

    sHead('8', 'FEE SCHEDULE MODIFICATIONS');
    para('Tidewise reserves the right to modify its Fee Schedule upon no less than thirty (30) days prior written notice to Client. Upon receipt of such notice, Client may accept the modified rates and continue under this Agreement, or terminate this Agreement within the thirty-day notice period without penalty, including without limitation no Early Termination Fee. Tidewise shall not utilize a fee modification as a mechanism to compel termination or to circumvent the exit provisions of this Agreement.');

    sHead('9', 'BUSINESS SALE OR TRANSFER');
    para('This Agreement is personal to Client and is not assignable or transferable without Tidewise\'s prior written consent. In the event of a sale or transfer of Client\'s business, Client shall notify Tidewise in writing within fifteen (15) days of the transaction. The Parties shall then enter good faith mediation to determine whether this Agreement shall continue under the new ownership. Failure to reach an agreement, failure to provide timely notice, or failure to participate in mediation shall be treated as a Client-initiated early termination under Section 6.2.');

    sHead('10', 'MUTUAL CONFIDENTIALITY');
    para('Each Party agrees to hold in strict confidence all non-public information disclosed by the other in connection with this Agreement, including but not limited to business strategies, financial data, customer information, pricing, and operational methods. Neither Party shall disclose, sell, or use the other\'s confidential information for any purpose outside this Agreement. This obligation survives termination for a period of two (2) years.');

    sHead('11', 'LIMITATION OF LIABILITY');
    para('Tidewise\'s obligations under this Agreement are limited to the delivery of Qualified Leads and the provision of digital services as described herein. Tidewise makes no representation or warranty regarding Client\'s business revenue, customer conversion rates, or overall business performance. Tidewise\'s total aggregate liability under this Agreement shall not exceed fees paid by Client in the three (3) months preceding the event giving rise to any claim.');

    sHead('12', 'GENERAL PROVISIONS');
    gp('Governing Law and Venue', 'This Agreement is governed by the laws of the State of North Carolina. Any mediation or legal proceedings shall take place exclusively in Brunswick County, North Carolina. Client irrevocably submits to jurisdiction therein.');
    gp('Entire Agreement', 'This Agreement, together with the initialed Fee Schedule, constitutes the entire agreement between the Parties and supersedes all prior discussions, representations, or understandings, whether oral or written.');
    gp('Amendments', 'Any modification to this Agreement must be made in writing and signed by both Parties.');
    gp('Severability', 'If any provision of this Agreement is found unenforceable, the remaining provisions shall remain in full force and effect.');
    gp('Waiver', 'Failure by either Party to enforce any provision shall not constitute a waiver of that right going forward.');
    gp('Electronic Signatures', 'Digital or electronic signatures are valid and binding under this Agreement.');

    doc.moveDown(0.3).fillColor('#888').fontSize(8).text('© 2026 Tidewise Solutions. Brunswick County, North Carolina. All Rights Reserved.', { align: 'center' }).fillColor('#000');

    // ── SIGNATURE PAGE ──────────────────────────────────────────────────────
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a6e7e').text('TIDEWISE SOLUTIONS', { align: 'center' });
    doc.fillColor('#000').font('Helvetica').fontSize(11).text('Digital Services and Licensing Agreement — Signature Page', { align: 'center' }).moveDown(0.5);
    doc.fontSize(9).text('By signing below, both Parties confirm they have read and understood this Agreement in its entirety and agree to be bound by its terms.').moveDown(0.8);
    hr();

    const sY = doc.y;
    // Client
    doc.fillColor('#1a6e7e').font('Helvetica-Bold').fontSize(8).text('CLIENT', M, sY);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(`${c.first_name} ${c.last_name}`, M, sY + 16);
    doc.font('Helvetica').fontSize(9);
    doc.text(`d/b/a ${c.business_name}`, M, sY + 32);
    doc.text(`Email: ${c.email}`, M, sY + 48);
    doc.text(`Phone: ${c.phone}`, M, sY + 64);
    doc.text(`Initials: ${c.initials}`, M, sY + 80);
    doc.text(`Signed: ${fmtDateTime(c.client_agreed_at)}`, M, sY + 96);
    doc.text(`IP: ${c.ip_address}`, M, sY + 112);
    doc.fillColor('#1a6e7e').font('Helvetica-Bold').fontSize(9).text('[Electronically Signed]', M, sY + 128);

    // Tidewise
    doc.fillColor('#1a6e7e').font('Helvetica-Bold').fontSize(8).text('TIDEWISE SOLUTIONS', col2X, sY);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('Jonathan Hughes', col2X, sY + 16);
    doc.font('Helvetica').fontSize(9);
    doc.text('d/b/a Tidewise Solutions', col2X, sY + 32);
    doc.text('Email: neal@tidewisesolutions.com', col2X, sY + 48);
    doc.text('Phone: 910-880-1900', col2X, sY + 64);
    doc.text('Initials: JH', col2X, sY + 80);
    doc.text(`Signed: ${fmtDateTime(c.neal_signed_at)}`, col2X, sY + 96);
    doc.fillColor('#1a6e7e').font('Helvetica-Bold').fontSize(9).text('[Electronically Signed]', col2X, sY + 112);

    doc.fillColor('#000'); doc.y = sY + 152; doc.x = M;
    hr();
    doc.font('Helvetica-Bold').fontSize(9).text('EXECUTION RECORD').moveDown(0.2);
    doc.font('Helvetica').fontSize(8);
    doc.text(`Agreement No.: ${c.agreement_no}`).moveDown(0.1);
    doc.text(`Client Signed:   ${fmtDateTime(c.client_agreed_at)}`).moveDown(0.1);
    doc.text(`Tidewise Signed: ${fmtDateTime(c.neal_signed_at)}`).moveDown(0.1);
    doc.text(`Client IP: ${c.ip_address}`).moveDown(0.1);
    doc.text(`Effective Date: ${c.effective_date}`).moveDown(0.5);
    doc.fillColor('#888').text('© 2026 Tidewise Solutions. Brunswick County, North Carolina. All Rights Reserved.', { align: 'center' }).fillColor('#000');

    // ── FEE SCHEDULE PAGE ───────────────────────────────────────────────────
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a6e7e').text('TIDEWISE SOLUTIONS', { align: 'center' });
    doc.fillColor('#000').font('Helvetica').fontSize(11).text('Fee Schedule', { align: 'center' });
    doc.fontSize(9).text(`Effective Date: ${fmtDate(c.client_agreed_at)}`, { align: 'center' }).moveDown(0.3);
    doc.fontSize(8).fillColor('#555').text('This Fee Schedule is incorporated by reference into the Tidewise Solutions Digital Services and Licensing Agreement signed by both parties. All fees listed below are in effect as of the date above.', { align: 'center' }).fillColor('#000').moveDown(0.5);
    hr();

    doc.font('Helvetica-Bold').fontSize(10).text('SETUP FEE').moveDown(0.2);
    doc.font('Helvetica').fontSize(9).text('One-Time Setup: ', { continued: true }).font('Helvetica-Bold').text('$255.00').moveDown(0.1);
    doc.font('Helvetica').fillColor('#555').fontSize(8).text('Non-refundable. No work commences prior to receipt.').fillColor('#000').moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10).text('PER-LEAD PERFORMANCE FEES').moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).text('Charged for each Qualified Lead delivered through Client\'s website. Rate determined by Business Type Designation.').moveDown(0.3);
    addTable(doc, M, W,
      ['Business Type', 'Form Type on Website', 'Per-Lead Fee'],
      [165, 180, 123],
      [
        ['Recurring Service Business', 'Calendar Booking Form', '$10.00 per booking'],
        ['Project-Based Business', 'Estimate Request Form', '$20.00 per lead'],
      ],
      c.business_type === 'booking' ? 0 : 1
    );
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10).text('MONTHLY RETAINER TIER STRUCTURE').moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).text('Applicable beginning the first calendar month following the Safe Harbor Period. Tiers advance upward and never decrease once established.').moveDown(0.3);
    addTable(doc, M, W,
      ['Tier', 'Monthly Qualified Leads', 'Monthly Retainer'],
      [155, 170, 143],
      [
        ['Dipping the Toe',  '1 – 4',   '$200.00'],
        ['Rising Tide',      '5 – 11',  '$500.00'],
        ['Catching the Wave','12 – 16', '$1,000.00'],
        ['Riding the Wave',  '17 – 30', '$1,500.00'],
        ['Tsunami',          '31 – 60', '$3,000.00'],
        ['Open Ocean*',      '61+',     '10% of platform revenue**'],
      ],
      -1
    );
    doc.font('Helvetica').fontSize(7.5).fillColor('#555');
    doc.text('* Open Ocean tier subject to mutual written agreement upon reaching the 61-lead threshold.').moveDown(0.1);
    doc.text('** Platform-generated revenue = documented revenue directly attributable to Tidewise Digital Assets.').fillColor('#000').moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10).text('BUYOUT & TRANSFER FEES').moveDown(0.2);
    addTable(doc, M, W,
      ['Fee Type', 'Amount', 'When Applicable'],
      [120, 80, 268],
      [
        ['Buyout Fee',   '$500.00', 'Client elects to retain Digital Assets upon exit prior to completion of full Retainer Period.'],
        ['Transfer Fee', '$99.00',  'Client elects to retain Digital Assets upon completion of full Retainer Period.'],
      ],
      -1
    );
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10).text('EARLY TERMINATION').moveDown(0.2);
    addTable(doc, M, W,
      ['Type', 'Fee'],
      [290, 178],
      [
        ['Client-Initiated Early Termination Fee', '3 months at current tier rate'],
        ['Tidewise-Initiated Termination Fee', 'No early termination fee'],
      ],
      -1
    );
    doc.moveDown(0.5);

    hr();
    doc.font('Helvetica-Bold').fontSize(9).text('ACKNOWLEDGMENT OF RECEIPT').moveDown(0.2);
    doc.font('Helvetica').fontSize(9).text('Client and Tidewise acknowledge receipt and review of this Fee Schedule. This document is incorporated by reference into the executed Digital Services and Licensing Agreement.').moveDown(0.3);
    doc.text(`Client Initials: ${c.initials}     Tidewise Initials: JH`).moveDown(0.1);
    doc.text(`Date: ${fmtDate(c.client_agreed_at)}`).moveDown(0.5);
    doc.fillColor('#888').fontSize(8).text('© 2026 Tidewise Solutions. Brunswick County, North Carolina. All Rights Reserved.', { align: 'center' });

    doc.end();
  });
}

function addTable(doc, x, totalW, headers, colWidths, rows, highlightRow) {
  const hH = 20;
  const rH = 18;
  const sy = doc.y + 4;

  // Backgrounds
  doc.rect(x, sy, totalW, hH).fill('#1a6e7e');
  rows.forEach((_, ri) => {
    const bg = ri === highlightRow ? '#dff0f5' : (ri % 2 === 0 ? '#f5f5f5' : '#ffffff');
    doc.rect(x, sy + hH + ri * rH, totalW, rH).fill(bg);
  });

  // Header text
  doc.fillColor('white').font('Helvetica-Bold').fontSize(8);
  headers.reduce((cx, h, i) => {
    doc.text(h, cx + 4, sy + 6, { width: colWidths[i] - 8, lineBreak: false });
    return cx + colWidths[i];
  }, x);

  // Row text
  rows.forEach((row, ri) => {
    doc.fillColor('#1a1a1a').font('Helvetica').fontSize(7.5);
    row.reduce((cx, cell, ci) => {
      doc.text(String(cell), cx + 4, sy + hH + ri * rH + 5, { width: colWidths[ci] - 8, lineBreak: false });
      return cx + colWidths[ci];
    }, x);
  });

  // Borders
  const tH = hH + rows.length * rH;
  doc.fillColor('#000').strokeColor('#bbb').lineWidth(0.5).rect(x, sy, totalW, tH).stroke();
  doc.moveTo(x, sy + hH).lineTo(x + totalW, sy + hH).stroke();
  rows.forEach((_, ri) => {
    if (ri > 0) doc.moveTo(x, sy + hH + ri * rH).lineTo(x + totalW, sy + hH + ri * rH).stroke();
  });
  colWidths.slice(0, -1).reduce((cx, w) => {
    doc.moveTo(cx + w, sy).lineTo(cx + w, sy + tH).stroke();
    return cx + w;
  }, x);

  doc.x = x; doc.y = sy + tH + 8;
  doc.strokeColor('#000').lineWidth(1).fillColor('#000');
}
