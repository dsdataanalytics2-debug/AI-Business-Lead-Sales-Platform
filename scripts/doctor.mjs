import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function logHeader(title) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}`);
}

function logResult(status, label, detail = '', fixHint = '') {
  let badge;
  if (status === 'PASS') {
    badge = `${colors.green}[PASS]${colors.reset}`;
  } else if (status === 'FAIL') {
    badge = `${colors.red}[FAIL]${colors.reset}`;
  } else {
    badge = `${colors.yellow}[WARN]${colors.reset}`;
  }

  console.log(` ${badge} ${colors.bold}${label}${colors.reset}`);
  if (detail) {
    console.log(`        ${detail}`);
  }
  if (fixHint) {
    console.log(`        ${colors.yellow}Fix hint: ${fixHint}${colors.reset}`);
  }
}

// Simple .env parser to avoid requiring npm install first
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

// TCP ping utility for Postgres & Redis without heavy client deps
async function tcpPing(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ ok: true });
      }
    });

    socket.on('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ ok: false, error: `Connection timed out after ${timeoutMs}ms` });
      }
    });

    socket.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ ok: false, error: err.message });
      }
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

function parseUrlHostPort(urlString, defaultPort) {
  try {
    const parsed = new URL(urlString);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || defaultPort,
      pathname: parsed.pathname || ''
    };
  } catch {
    return null;
  }
}

async function runDoctor() {
  console.log(`${colors.bold}LeadMate Environment Doctor${colors.reset}`);
  console.log(`Checking local environment against project requirements...\n`);

  let hasFailures = false;
  let hasWarnings = false;

  // 1. Check Node.js and npm versions
  logHeader('1. Node.js Runtime');
  const nodeVersion = process.version;
  const majorNode = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorNode >= 20) {
    logResult('PASS', `Node.js Version ${nodeVersion}`, `Meets requirement: >=20.0.0 (engines)`);
  } else {
    hasFailures = true;
    logResult('FAIL', `Node.js Version ${nodeVersion}`, `Current version is ${nodeVersion}`, `Install Node.js LTS (>= 20.0.0) from https://nodejs.org`);
  }

  // 2. Check Environment Variables (.env vs .env.example)
  logHeader('2. Environment Configuration');
  const envExamplePath = path.join(rootDir, '.env.example');
  const envPath = path.join(rootDir, '.env');

  if (!fs.existsSync(envExamplePath)) {
    hasFailures = true;
    logResult('FAIL', '.env.example file missing', 'Root .env.example was not found', 'Create .env.example with required variables');
  }

  if (!fs.existsSync(envPath)) {
    hasWarnings = true;
    logResult('WARN', '.env file does not exist yet', 'No .env found in root directory', 'Copy .env.example to .env and configure your local settings: cp .env.example .env');
  }

  const exampleEnv = parseEnvFile(envExamplePath);
  const currentEnv = { ...exampleEnv, ...parseEnvFile(envPath), ...process.env };

  const requiredKeys = [
    'DATABASE_URL',
    'DATABASE_URL_TEST',
    'REDIS_URL',
    'REDIS_URL_TEST',
    'REDIS_KEY_PREFIX',
    'SESSION_SECRET'
  ];

  const missingKeys = requiredKeys.filter((k) => !currentEnv[k] || currentEnv[k].trim() === '');
  if (missingKeys.length === 0) {
    logResult('PASS', 'Required environment variables present', `Checked: ${requiredKeys.join(', ')}`);
  } else {
    hasFailures = true;
    logResult('FAIL', 'Missing required environment variables', `Missing: ${missingKeys.join(', ')}`, `Add missing keys to your .env file`);
  }

  // 3. PostgreSQL Database Checks
  logHeader('3. PostgreSQL Connection & Safety Guard');
  const dbUrl = currentEnv.DATABASE_URL;
  const dbTestUrl = currentEnv.DATABASE_URL_TEST;

  if (dbUrl) {
    const parsedDb = parseUrlHostPort(dbUrl, 5432);
    if (parsedDb) {
      const pingRes = await tcpPing(parsedDb.host, parsedDb.port);
      if (pingRes.ok) {
        logResult('PASS', `PostgreSQL reachable at ${parsedDb.host}:${parsedDb.port}`, `Database: ${parsedDb.pathname.replace(/^\//, '')}`);
      } else {
        hasWarnings = true;
        logResult('WARN', `PostgreSQL unreachable at ${parsedDb.host}:${parsedDb.port}`, pingRes.error, 'Ensure PostgreSQL service is running on the configured host/port');
      }
    } else {
      hasFailures = true;
      logResult('FAIL', 'Invalid DATABASE_URL format', dbUrl, 'Format should be postgresql://USER:PASSWORD@HOST:PORT/DBNAME');
    }
  }

  // Check DATABASE_URL_TEST safety rule (*_test)
  if (dbTestUrl) {
    const parsedTestDb = parseUrlHostPort(dbTestUrl, 5432);
    const dbName = parsedTestDb ? parsedTestDb.pathname.replace(/^\//, '') : '';
    if (dbName.endsWith('_test')) {
      logResult('PASS', `Test Database Safety Guard: '${dbName}' ends with '_test'`, `DATABASE_URL_TEST is safe for test execution`);
    } else {
      hasFailures = true;
      logResult('FAIL', `Test Database Safety Guard Failed: '${dbName}'`, `Test DB name MUST end with '_test'`, `Update DATABASE_URL_TEST in .env to use a database name ending with '_test' (e.g. leadmate_test)`);
    }
  }

  // 4. Redis Connection Checks
  logHeader('4. Redis Connection & BullMQ');
  const redisUrl = currentEnv.REDIS_URL;
  const redisTestUrl = currentEnv.REDIS_URL_TEST;

  if (redisUrl) {
    const parsedRedis = parseUrlHostPort(redisUrl, 6379);
    if (parsedRedis) {
      const pingRedis = await tcpPing(parsedRedis.host, parsedRedis.port);
      if (pingRedis.ok) {
        logResult('PASS', `Redis reachable at ${parsedRedis.host}:${parsedRedis.port}`);
      } else {
        hasWarnings = true;
        logResult('WARN', `Redis unreachable at ${parsedRedis.host}:${parsedRedis.port}`, pingRedis.error, 'Ensure Redis (or Memurai on Windows) is running on the configured port');
      }
    } else {
      hasFailures = true;
      logResult('FAIL', 'Invalid REDIS_URL format', redisUrl, 'Format should be redis://HOST:PORT/INDEX');
    }
  }

  if (redisTestUrl) {
    const parsedRedisTest = parseUrlHostPort(redisTestUrl, 6379);
    if (parsedRedisTest) {
      logResult('PASS', `Test Redis configured at ${parsedRedisTest.host}:${parsedRedisTest.port}`);
    }
  }

  // Summary
  console.log('\n----------------------------------------');
  if (hasFailures) {
    console.log(`${colors.red}${colors.bold}Doctor Status: FAIL — Fix required issues above before proceeding.${colors.reset}\n`);
    process.exit(1);
  } else if (hasWarnings) {
    console.log(`${colors.yellow}${colors.bold}Doctor Status: PASS (with warnings) — Core environment is valid.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.green}${colors.bold}Doctor Status: ALL PASS — Environment is fully configured!${colors.reset}\n`);
    process.exit(0);
  }
}

runDoctor().catch((err) => {
  console.error('Fatal error running doctor:', err);
  process.exit(1);
});
