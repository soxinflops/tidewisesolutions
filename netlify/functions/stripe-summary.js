exports.handler = async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  const now = new Date();
  const startOfMonth = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const startOfYear  = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);

  async function fetchTxns(type, since) {
    const res = await fetch(
      `https://api.stripe.com/v1/balance_transactions?type=${type}&created[gte]=${since}&limit=100`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    return res.json();
  }

  async function fetchAll(since) {
    const [charges, payments] = await Promise.all([
      fetchTxns('charge',  since),
      fetchTxns('payment', since),
    ]);
    return [...(charges.data || []), ...(payments.data || [])];
  }

  const [monthTxns, yearTxns] = await Promise.all([
    fetchAll(startOfMonth),
    fetchAll(startOfYear),
  ]);

  const sum = (txns, field) => txns.reduce((s, t) => s + (t[field] || 0), 0);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      month: { gross: sum(monthTxns, 'amount'), net: sum(monthTxns, 'net'), fee: sum(monthTxns, 'fee'), count: monthTxns.length },
      year:  { gross: sum(yearTxns,  'amount'), net: sum(yearTxns,  'net'), fee: sum(yearTxns,  'fee'), count: yearTxns.length  },
    }),
  };
};
