'use strict';

// Focused deployment checks; all storage is throwaway, never the cloud DB.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ADMIN = { email: 'deployment-admin@hostel.test', password: 'Deployment-Test-Only!53' };

function isolatedEnv(dir, backend) {
  return {
    ...process.env, NODE_ENV: 'test', VERCEL: '', LOG_LEVEL: 'none',
    DB_PATH: path.join(dir, 'app.db'), UPLOAD_DIR: path.join(dir, 'uploads'),
    TURSO_DATABASE_URL: backend === 'libsql' ? pathToFileURL(path.join(dir, 'app.db')).href : '',
    TURSO_AUTH_TOKEN: '', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
    JWT_SECRET: 'deployment-test-secret-never-used-in-production',
    ALLOW_DEMO_ADMIN_PASSWORD: 'false',
  };
}

async function importedServer(env) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e',
    "const app=require('./src/app'); const s=app.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"
  ], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const deadline = Date.now() + 10000;
  while (!/READY:(\d+)/.test(output)) {
    if (child.exitCode !== null) throw new Error('Imported app exited: ' + output);
    if (Date.now() > deadline) { child.kill(); throw new Error('Imported app readiness timeout'); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    base: 'http://127.0.0.1:' + output.match(/READY:(\d+)/)[1],
    async stop() {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    },
  };
}

async function request(server, route, body, token) {
  const response = await fetch(server.base + '/api' + route, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.match(response.headers.get('content-type'), /application\/json/);
  return { status: response.status, data: await response.json() };
}

for (const backend of ['sqlite', 'libsql']) {
  test(`imported app initializes, accounts and sessions survive a fresh process (${backend})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-buddy-deploy-test-'));
    const env = isolatedEnv(dir, backend);
    let server;
    try {
      server = await importedServer(env);
      const health = await request(server, '/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.storage, backend === 'sqlite' ? 'persistent-local' : 'persistent-libsql-file');
      // No demo users, hostels, or known demo passwords are seeded at startup.
      assert.deepEqual((await request(server, '/hostels')).data, []);
      const admin = await request(server, '/auth/login', ADMIN);
      assert.equal(admin.status, 200);
      assert.equal(admin.data.user.role, 'super_admin');
      const hostel = await request(server, '/hostels', { hostel_name: 'Deployment Test Hostel 0053', capacity: 10 }, admin.data.token);
      assert.equal(hostel.status, 201);
      const student = { name: 'Deployment Test 0053', email: 'student0053@hostel.test', password: 'Student-Test!0053',
        roll_no: '2024BCD0053-TEST', hostel_id: hostel.data.hostel_id, room_number: 'T-53' };
      const registration = await request(server, '/auth/register', student);
      assert.equal(registration.status, 201);
      await server.stop(); server = null;
      server = await importedServer({ ...env, ADMIN_PASSWORD: 'Changed-Env-Not-A-Reset!53' });
      assert.equal((await request(server, '/health')).status, 200);
      const login = await request(server, '/auth/login', { email: student.email, password: student.password });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.roll_no, student.roll_no);
      const profile = await request(server, '/users/me', null, registration.data.token);
      assert.equal(profile.status, 200); // stable JWT_SECRET across process restart
      assert.equal(profile.data.user_id, registration.data.user.user_id);
      assert.equal((await request(server, '/auth/login', ADMIN)).status, 200);
      assert.equal((await request(server, '/auth/login', { ...ADMIN, password: 'Changed-Env-Not-A-Reset!53' })).status, 401);
      const bad = await request(server, '/auth/login', { ...ADMIN, password: 'wrong' });
      assert.equal(bad.data.error.code, 'INVALID_CREDENTIALS');
    } finally {
      if (server) await server.stop();
      // dir is a concrete mkdtemp result, verified before recursive cleanup.
      assert.ok(dir.startsWith(path.join(os.tmpdir(), 'hostel-buddy-deploy-test-')));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`transaction commit, rollback and foreign-key enforcement (${backend})`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-buddy-deploy-test-'));
    try {
      const code = `
        const assert=require('node:assert/strict');
        const db=require('./src/db/connection');
        (async()=>{
          await db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id));');
          await db.transaction(async()=>{ await db.prepare('INSERT INTO parent VALUES (?)').run(1); });
          assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM parent').get()).n,1);
          await assert.rejects(db.transaction(async()=>{
            await db.prepare('INSERT INTO parent VALUES (?)').run(2);
            await db.prepare('INSERT INTO child VALUES (?)').run(999);
          }),/FOREIGN KEY/i);
          assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM parent').get()).n,1);
          assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM child').get()).n,0);
          await db.transaction(async()=>{
            await db.prepare('INSERT INTO parent VALUES (?)').run(2);
            await db.prepare('INSERT INTO child VALUES (?)').run(2);
          });
          assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM child').get()).n,1);
          await db.close();
        })().catch(e=>{ console.error(e.message); process.exitCode=1; });`;
      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code],
        { cwd: ROOT, env: isolatedEnv(dir, backend), encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      assert.ok(dir.startsWith(path.join(os.tmpdir(), 'hostel-buddy-deploy-test-')));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('Vercel refuses temporary DB, missing token and default password', () => {
  const baseEnv = { ...process.env, VERCEL: '1', NODE_ENV: 'production',
    JWT_SECRET: 'test-only-strong-enough-secret-53', ADMIN_PASSWORD: ADMIN.password,
    TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', ALLOW_DEMO_ADMIN_PASSWORD: 'false' };
  for (const override of [{}, { TURSO_DATABASE_URL: 'file:test.db', TURSO_AUTH_TOKEN: 'test' },
    { TURSO_DATABASE_URL: 'libsql://test.turso.io', TURSO_AUTH_TOKEN: 'test', ADMIN_PASSWORD: 'admin123' }]) {
    const result = spawnSync(process.execPath, ['-e', "require('./src/config/env')"],
      { cwd: ROOT, env: { ...baseEnv, ...override }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to start/);
  }
});

test('default admin password needs explicit demo opt-in and still requires durable storage', () => {
  const env = { ...process.env, VERCEL: '1', NODE_ENV: 'production',
    JWT_SECRET: 'test-only-strong-enough-secret-53', ADMIN_PASSWORD: 'admin123',
    ALLOW_DEMO_ADMIN_PASSWORD: 'true', TURSO_DATABASE_URL: 'libsql://test.turso.io', TURSO_AUTH_TOKEN: 'test' };
  const allowed = spawnSync(process.execPath, ['-e', "require('./src/config/env')"],
    { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stderr, /Demo-only weak admin password enabled/);
  const missingDb = spawnSync(process.execPath, ['-e', "require('./src/config/env')"],
    { cwd: ROOT, env: { ...env, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' }, encoding: 'utf8' });
  assert.notEqual(missingDb.status, 0);
  assert.match(missingDb.stderr, /durable accounts/);
});

test('browser API preserves invalid-credential message and detects HTML routing failures', async () => {
  const sandbox = { window: {}, Auth: { getToken: () => null, clear: () => { throw new Error('login must not expire session'); } },
    location: { pathname: '/login.html', replace: () => { throw new Error('unexpected redirect'); } },
    fetch: async () => ({ status: 401, ok: false, text: async () => JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }) }) };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/api.js'), 'utf8'), sandbox);
  await assert.rejects(sandbox.window.API.post('/auth/login', ADMIN), /Invalid email or password/);
  sandbox.fetch = async () => ({ status: 200, ok: true, text: async () => '<html>Wrong API route</html>' });
  await assert.rejects(sandbox.window.API.get('/health'), /deployment routing/);
});
