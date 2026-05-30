exports.handler = async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  const now = new Date();
  const startOfMonth = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const startOfYear  = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);

  async function fetchTxns(since) {
    const res = await fetch(
      `https://api.stripe.com/v1/balance_transactions?type=charge&created[gte]=${since}&limit=100`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    return res.json();
  }

  const [monthData, yearData] = await Promise.all([
    fetchTxns(startOfMonth),
    fetchTxns(startOfYear),
  ]);

  const sum = (data, field) => (data.data || []).reduce((s, t) => s + (t[field] || 0), 0);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      month: {
        gross: sum(monthData, 'amount'),
        net:   sum(monthData, 'net'),
        fee:   sum(monthData, 'fee'),
        count: (monthData.data || []).length,
      },
      year: {
        gross: sum(yearData, 'amount'),
        net:   sum(yearData, 'net'),
        fee:   sum(yearData, 'fee'),
        count: (yearData.data || []).length,
      },
    }),
  };
};
