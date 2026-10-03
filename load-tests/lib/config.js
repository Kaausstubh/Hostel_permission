/**
 * Load Test Configuration & CLI Arguments Parser
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment from backend/.env if available
dotenv.config({ path: path.resolve(__dirname, '../../Hostel_permission/backend/.env') });

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    users: null,
    duration: null,
    rate: null,
    ramp: null,
    stress: false,
    deployed: false,
    local: false,
    apiUrl: null,
    baseUrl: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--users' && args[i + 1]) {
      parsed.users = parseInt(args[++i], 10);
    } else if (arg === '--duration' && args[i + 1]) {
      parsed.duration = parseInt(args[++i], 10);
    } else if (arg === '--rate' && args[i + 1]) {
      parsed.rate = parseInt(args[++i], 10);
    } else if (arg === '--ramp' && args[i + 1]) {
      parsed.ramp = parseInt(args[++i], 10);
    } else if (arg === '--stress') {
      parsed.stress = true;
    } else if (arg === '--deployed') {
      parsed.deployed = true;
    } else if (arg === '--local') {
      parsed.local = true;
    } else if (arg === '--api-url' && args[i + 1]) {
      parsed.apiUrl = args[++i];
    } else if (arg === '--base-url' && args[i + 1]) {
      parsed.baseUrl = args[++i];
    }
  }

  return parsed;
};

const cliArgs = parseArgs();

const DEPLOYED_BACKEND = 'https://hostel-permission-8add.onrender.com';
const DEPLOYED_FRONTEND = 'https://iiitpune-hosteel-gate-management.vercel.app';
const LOCAL_BACKEND = 'http://localhost:5001';
const LOCAL_FRONTEND = 'http://localhost:5173';

const apiUrl =
  cliArgs.apiUrl ||
  process.env.API_URL ||
  process.env.LOADTEST_API_URL ||
  (cliArgs.deployed ? DEPLOYED_BACKEND : LOCAL_BACKEND);

const baseUrl =
  cliArgs.baseUrl ||
  process.env.BASE_URL ||
  process.env.LOADTEST_BASE_URL ||
  (cliArgs.deployed ? DEPLOYED_FRONTEND : LOCAL_FRONTEND);

const config = {
  apiUrl: apiUrl.replace(/\/+$/, ''),
  baseUrl: baseUrl.replace(/\/+$/, ''),
  deployedBackend: DEPLOYED_BACKEND,
  deployedFrontend: DEPLOYED_FRONTEND,
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_replace_before_production_32ch',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel',
  redisUrl: process.env.REDIS_URL || null,
  users: cliArgs.users || (cliArgs.stress ? 5000 : 100),
  duration: cliArgs.duration || (cliArgs.stress ? 40 : 20),
  rate: cliArgs.rate || 50,
  ramp: cliArgs.ramp || 5,
  isStress: cliArgs.stress,
  isDeployed: apiUrl.includes('onrender.com') || cliArgs.deployed,
  fixturesDir: path.resolve(__dirname, '../fixtures'),
  reportsDir: path.resolve(__dirname, '../../reports'),
  tokensFile: path.resolve(__dirname, '../fixtures/testTokens.json'),
  manifestFile: path.resolve(__dirname, '../fixtures/manifest.json'),
};

module.exports = config;
