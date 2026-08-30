'use strict';

// Test runner:  npm test
//
// Starts the server on its own port against a throwaway database, waits for it
// to answer, runs every suite against it, then shuts the server down and
// deletes the database. The suites used to require a manually started server
// and wrote into data/hostel.db — the demo database — so every run left junk
// accounts behind. Nothing here touches the development data.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.HB_TEST_PORT) || 4010;
const BASE = `http://localhost:${PORT}/api`;
const DB_PATH = path.join(ROOT, 'data', 'test.db');
const UPLOAD_DIR = path.join(ROOT, 'uploads', '.test');
const HEALTH_TIMEOUT_MS = 20000;

const SUITES = ['auth', 'complaints', 'admin', 'dashboard', 'regression'];

// SQLite in WAL mode keeps two sidecar files next to the database.
function removeTestDatabase() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_PATH + suffix);
    } catch {
      /* not there — fine */
    }
  }
}

// Uploads are isolated the same way the database is, so a test run never
// leaves image files sitting in the real uploads directory.
function removeTestUploads() {
  try {
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  } catch {
    /* not there — fine */
  }
}

const childEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(PORT),
  DB_PATH,
  UPLOAD_DIR,
  HB_TEST_BASE: BASE,
};

function startServer() {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src', 'server.js')],
    { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // Keep the server's own output out of the test report, but hold on to it so
  // a startup failure can be shown.
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(server) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early (code ${server.exitCode}):\n${server.getOutput()}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy within ${HEALTH_TIMEOUT_MS}ms:\n${server.getOutput()}`);
}

function runSuite(name) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', path.join(__dirname, `${name}.test.js`)],
      { cwd: ROOT, env: childEnv, stdio: 'inherit' }
    );
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  removeTestDatabase();
  removeTestUploads();

  console.log(`[test] starting server on port ${PORT} with a throwaway database`);
  const server = startServer();

  let failed = [];
  try {
    await waitForHealth(server);
    console.log('[test] server ready\n');

    for (const name of SUITES) {
      const code = await runSuite(name);
      if (code !== 0) failed.push(name);
    }
  } finally {
    server.kill();
    // Give the process a moment to release its file handles on Windows before
    // the database file is deleted.
    await new Promise((r) => setTimeout(r, 400));
    removeTestDatabase();
    removeTestUploads();
  }

  if (failed.length) {
    console.error(`\n[test] FAILED suites: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\n[test] all ${SUITES.length} suites passed.`);
}

main().catch((err) => {
  console.error(`\n[test] could not run the suites: ${err.message}`);
  removeTestDatabase();
  removeTestUploads();
  process.exit(1);
});
