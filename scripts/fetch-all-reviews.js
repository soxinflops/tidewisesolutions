#!/usr/bin/env node
// Fetches Google reviews for all Tidewise client sites via SerpAPI.
// Runs via .github/workflows/refresh-reviews.yml — outputs to data/*.json.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY    = process.env.SERPAPI_KEY;
const MIN_RATING  = 4;

const BUSINESSES = [
  {
    slug:        'ccst',
    name:        'Coastal Carolina Synthetic Turf',
    city:        'Leland, NC',
    max_reviews: 6,
    out:         '../data/ccst-reviews.json',
  },
  {
    slug:        'htsw',
    name:        'High Tide Soft Wash LLC',
    city:        'NC',
    place_id:    'ChIJY7s-sOVFaEMR0LyOL5wNr10',
    ll:          '@34.1,-78.2,11z',
    max_reviews: 25,
    out:         '../data/htsw-reviews.json',
  },
  {
    slug:        'tw',
    name:        'Tidewise Solutions',
    city:        'Leland, NC',
    max_reviews: 6,
    out:         '../data/tw-reviews.json',
  },
];

if (!API_KEY) {
  console.error('SERPAPI_KEY env var is not set');
  process.exit(1);
}

function serpGet(params) {
  return new Promise((resolve, reject) => {
    const qs  = new URLSearchParams({ ...params, api_key: API_KEY }).toString();
    const url = `https://serpapi.com/search.json?${qs}`;
    https.get(url, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse failed for ${params.q}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchBusiness(biz) {
  console.log(`\n── ${biz.name} ──`);

  // Step 1 — find the place to get data_id
  const searchQuery = [biz.name, biz.city].filter(Boolean).join(' ');
  const mapResult = await serpGet({
    engine: 'google_maps',
    q:      searchQuery,
    type:   'search',
    ...(biz.ll ? { ll: biz.ll } : {}),
  });

  const results = mapResult.local_results || [];
  const place = biz.place_id
    ? results.find(r => r.place_id === biz.place_id) || results[0] || mapResult.place_results
    : results.find(r => r.title && r.title.toLowerCase().includes(biz.name.split(' ')[0].toLowerCase())) || results[0] || mapResult.place_results;

  if (!place?.data_id) {
    console.log(`  Not found in Maps — skipping (keeping existing file)`);
    return;
  }

  console.log(`  Found: "${place.title}" | data_id: ${place.data_id} | (${place.rating ?? '?'} stars, ${place.reviews ?? 0} reviews)`);

  // Step 2 — fetch reviews (paginate until we hit biz.max_reviews)
  const rawReviews = [];
  let nextToken = null;
  do {
    const params = { engine: 'google_maps_reviews', data_id: place.data_id, hl: 'en', gl: 'us' };
    if (nextToken) params.next_page_token = nextToken;
    const reviewResult = await serpGet(params);
    const page = reviewResult.reviews || [];
    rawReviews.push(...page);
    nextToken = reviewResult.serpapi_pagination?.next_page_token || null;
  } while (nextToken && rawReviews.length < biz.max_reviews);

  console.log(`  Raw reviews fetched: ${rawReviews.length}`);

  const reviews = rawReviews
    .filter(r => r.rating >= MIN_RATING && r.snippet && r.snippet.trim().length > 30)
    .slice(0, biz.max_reviews)
    .map(r => ({
      author: r.user?.name || 'Verified Customer',
      rating: r.rating,
      text:   r.snippet.trim(),
      date:   r.iso_date_utc || r.iso_date || r.date || null,
    }));

  if (reviews.length === 0) {
    console.log(`  No valid reviews returned — keeping existing file unchanged`);
    return { skipped: true };
  }

  const out = {
    updated:       new Date().toISOString().split('T')[0],
    rating:        place.rating   ?? null,
    total_reviews: place.reviews  ?? 0,
    reviews,
  };

  const outPath = path.join(__dirname, biz.out);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`  Wrote ${reviews.length} review(s) → ${biz.out}`);
  return { ok: true };
}

async function main() {
  const failures = [];

  for (const biz of BUSINESSES) {
    try {
      await fetchBusiness(biz);
    } catch (err) {
      console.error(`  ERROR for ${biz.slug}: ${err.message}`);
      failures.push(`${biz.slug}: ${err.message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n⚠️  ${failures.length} business(es) failed to update:`);
    failures.forEach(f => console.error(`  • ${f}`));
    console.error('\nExisting JSON files were NOT modified. GitHub will send a failure email.');
    process.exit(1);
  }

  console.log('\n✓ All businesses updated successfully.');
}

main();
