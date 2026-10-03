/**
 * Render Free Instance Cold Start vs Warm Latency Benchmark
 */

const ApiClient = require('../lib/apiClient');
const config = require('../lib/config');

async function benchmarkColdStart(targetUrl = config.deployedBackend) {
  console.log('\n' + '═'.repeat(70));
  console.log(`❄️  RENDER COLD START VS WARM LATENCY BENCHMARK`);
  console.log(`Target: ${targetUrl}`);
  console.log('═'.repeat(70));

  const client = new ApiClient(targetUrl);

  // 1. Initial Probe (Cold or Inactive)
  console.log('📡 Step 1: Firing initial probe (measuring initial response / cold wake-up)...');
  const coldStartProbe = await client.get('/api/health', { timeout: 60000 });

  console.log(`\n⏱️  Probe 1 (Initial / Potential Cold Start):`);
  console.log(`   • Status: ${coldStartProbe.status}`);
  console.log(`   • Latency: ${coldStartProbe.durationMs.toFixed(2)} ms`);
  console.log(`   • Server Time: ${coldStartProbe.data?.timestamp || 'N/A'}`);
  console.log(`   • Uptime: ${coldStartProbe.data?.uptime ? `${coldStartProbe.data.uptime.toFixed(1)}s` : 'N/A'}`);

  const isCold = coldStartProbe.durationMs > 2500;
  console.log(`   • Classification: ${isCold ? '❄️  COLD START (Container spin-up detected)' : '🔥 WARM (Container was already running)'}`);

  // 2. Warm baseline measurements (10 sequential pings to measure warm HTTP/2 & keep-alive latency)
  console.log('\n📡 Step 2: Measuring 10 warm sequential requests...');
  const warmLatencies = [];

  for (let i = 1; i <= 10; i++) {
    const res = await client.get('/api/health', { timeout: 10000 });
    warmLatencies.push(res.durationMs);
    process.stdout.write(`   [Ping ${i}/10] ${res.durationMs.toFixed(1)}ms `);
  }
  console.log('\n');

  const sum = warmLatencies.reduce((a, b) => a + b, 0);
  const avgWarm = sum / warmLatencies.length;
  const minWarm = Math.min(...warmLatencies);
  const maxWarm = Math.max(...warmLatencies);

  console.log('📊 Cold vs Warm Summary:');
  console.log(`   • Initial Probe Latency: ${coldStartProbe.durationMs.toFixed(1)} ms`);
  console.log(`   • Warm Average Latency:  ${avgWarm.toFixed(1)} ms (Min: ${minWarm.toFixed(1)}ms, Max: ${maxWarm.toFixed(1)}ms)`);
  console.log(`   • Difference / Delta:    +${(coldStartProbe.durationMs - avgWarm).toFixed(1)} ms`);

  // Readiness check
  const readyProbe = await client.get('/api/ready', { timeout: 10000 });
  console.log(`\n🏥 Backend Readiness State:`);
  console.log(`   • Status: ${readyProbe.status} (${readyProbe.durationMs.toFixed(1)}ms)`);
  console.log(`   • MongoDB State: ${readyProbe.data?.checks?.mongodb || 'N/A'}`);
  console.log(`   • Redis State:   ${readyProbe.data?.checks?.redis || 'N/A'}`);

  return {
    targetUrl,
    coldProbe: {
      status: coldStartProbe.status,
      latencyMs: coldStartProbe.durationMs,
      isCold,
      uptime: coldStartProbe.data?.uptime,
    },
    warm: {
      samples: warmLatencies,
      avgMs: Number(avgWarm.toFixed(2)),
      minMs: Number(minWarm.toFixed(2)),
      maxMs: Number(maxWarm.toFixed(2)),
    },
    readiness: readyProbe.data,
  };
}

if (require.main === module) {
  benchmarkColdStart().then(() => process.exit(0));
}

module.exports = benchmarkColdStart;
