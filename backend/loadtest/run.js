/* eslint-disable no-console */
const autocannon = require('autocannon');

const BASE_URL = process.env.LOADTEST_BASE_URL || 'http://localhost:5000';
const JWT_TOKEN = process.env.LOADTEST_JWT || '';
const DURATION = parseInt(process.env.LOADTEST_DURATION || '30', 10);
const CONNECTIONS = parseInt(process.env.LOADTEST_CONNECTIONS || '100', 10);

const run = (opts) => new Promise((resolve, reject) => {
  const instance = autocannon(opts, (err, result) => {
    if (err) return reject(err);
    resolve(result);
  });
  autocannon.track(instance, { renderProgressBar: true });
});

const summarize = (name, result) => {
  console.log(`\n=== ${name} ===`);
  console.log(`Req/s avg: ${result.requests.average}`);
  console.log(`Latency p95: ${result.latency.p95} ms`);
  console.log(`Latency p99: ${result.latency.p99} ms`);
  console.log(`Errors: ${result.errors}`);
  console.log(`Timeouts: ${result.timeouts}`);
};

const main = async () => {
  console.log(`Running load tests against ${BASE_URL}`);

  const health = await run({
    url: `${BASE_URL}/api/health`,
    connections: CONNECTIONS,
    duration: DURATION,
    method: 'GET',
  });
  summarize('Health Endpoint', health);

  if (JWT_TOKEN) {
    const status = await run({
      url: `${BASE_URL}/api/student/status`,
      connections: CONNECTIONS,
      duration: DURATION,
      method: 'GET',
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    });
    summarize('Student Status Endpoint', status);
  } else {
    console.log('\nSkipping /api/student/status test (LOADTEST_JWT not provided).');
  }
};

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
