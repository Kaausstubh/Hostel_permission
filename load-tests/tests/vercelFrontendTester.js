/**
 * Vercel Frontend Deployment Performance & Asset Benchmark
 */

const ApiClient = require('../lib/apiClient');
const config = require('../lib/config');

async function benchmarkFrontend(frontendUrl = config.deployedFrontend) {
  console.log('\n' + '═'.repeat(70));
  console.log(`🌐 VERCEL FRONTEND PERFORMANCE BENCHMARK`);
  console.log(`Target: ${frontendUrl}`);
  console.log('═'.repeat(70));

  const client = new ApiClient(frontendUrl);

  const routesToTest = [
    { path: '/', label: 'Landing / Root' },
    { path: '/login', label: 'Login Portal' },
    { path: '/student', label: 'Student Portal SPA Route' },
    { path: '/scanner', label: 'Security Scanner SPA Route' },
    { path: '/dashboard', label: 'Warden Dashboard SPA Route' },
    { path: '/simulator', label: 'WhatsApp Simulator Route' },
  ];

  console.log('📡 Testing Frontend Route Servicing & CDN Edge Cache Latency:');
  const routeResults = [];

  for (const r of routesToTest) {
    const res = await client.get(r.path, { timeout: 15000 });
    const isHtml = res.headers['content-type']?.includes('text/html');
    const vercelCache = res.headers['x-vercel-cache'] || 'N/A';
    const serverTiming = res.headers['server-timing'] || 'N/A';

    console.log(`   • ${r.label.padEnd(30)}: Status ${res.status} | ${res.durationMs.toFixed(1)}ms | Cache: ${vercelCache} | Size: ${res.rawData?.length || 0} bytes`);
    routeResults.push({
      path: r.path,
      label: r.label,
      status: res.status,
      durationMs: Number(res.durationMs.toFixed(2)),
      vercelCache,
      sizeBytes: res.rawData?.length || 0,
      isHtml,
    });
  }

  // Parse HTML to discover bundle assets
  const rootRes = await client.get('/', { timeout: 15000 });
  const html = rootRes.rawData || '';
  const scriptMatches = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  const styleMatches = [...html.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);

  const assets = [...scriptMatches, ...styleMatches];
  console.log(`\n📦 Discovered Static Bundle Assets (${assets.length} items):`);
  const assetResults = [];

  for (const assetPath of assets) {
    const assetRes = await client.get(assetPath, { timeout: 15000 });
    const cacheControl = assetRes.headers['cache-control'] || 'N/A';
    const vercelCache = assetRes.headers['x-vercel-cache'] || 'N/A';
    const encoding = assetRes.headers['content-encoding'] || 'identity';

    console.log(`   • ${assetPath.slice(0, 40).padEnd(42)}: Status ${assetRes.status} | ${assetRes.durationMs.toFixed(1)}ms | ${encoding} | Size: ${assetRes.rawData?.length || 0} bytes`);
    assetResults.push({
      path: assetPath,
      status: assetRes.status,
      durationMs: Number(assetRes.durationMs.toFixed(2)),
      sizeBytes: assetRes.rawData?.length || 0,
      cacheControl,
      vercelCache,
      encoding,
    });
  }

  const avgRouteMs = routeResults.reduce((a, b) => a + b.durationMs, 0) / routeResults.length;
  console.log(`\n📊 Frontend Summary:`);
  console.log(`   • Average Route Latency: ${avgRouteMs.toFixed(1)} ms`);
  console.log(`   • Asset Delivery: ${assetResults.every((a) => a.status === 200) ? '✅ All Assets 200 OK' : '⚠️ Missing assets'}`);

  return {
    frontendUrl,
    routeResults,
    assetResults,
    avgRouteMs: Number(avgRouteMs.toFixed(2)),
  };
}

if (require.main === module) {
  benchmarkFrontend().then(() => process.exit(0));
}

module.exports = benchmarkFrontend;
