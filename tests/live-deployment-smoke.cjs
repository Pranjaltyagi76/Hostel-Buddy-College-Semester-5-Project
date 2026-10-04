'use strict';

// Manual, opt-in live acceptance test. Never run as part of npm test.
// Creates isolated fixtures in `before`; verifies them after redeployment in
// `after`. The ignored state file holds test credentials and must not be shared.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BASE = process.env.HB_LIVE_BASE;
const mode = process.argv[2];
const stateFile = path.resolve(__dirname, '../tmp/live-deployment-smoke-state.json');
assert.equal(process.env.HB_LIVE_TEST_ALLOW_WRITE, 'true', 'Explicit HB_LIVE_TEST_ALLOW_WRITE=true is required');
assert.equal(BASE, 'https://hostel-buddy-college-project.vercel.app', 'Use the verified project URL');
assert.ok(['before', 'after'].includes(mode), 'Use before or after');

async function call(method, route, body, token) {
  const response = await fetch(BASE + '/api' + route, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  return { status: response.status, data: await response.json() };
}
function pass(name) { console.log('PASS: ' + name); }
function save(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}

(async () => {
  const health = await call('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.storage, 'persistent-turso');
  pass('public API uses persistent Turso storage');
  const admin = await call('POST', '/auth/login', {
    email: process.env.HB_LIVE_ADMIN_EMAIL || 'admin@hostel.test',
    password: process.env.HB_LIVE_ADMIN_PASSWORD,
  });
  assert.equal(admin.status, 200, admin.data.error?.code);
  assert.equal(admin.data.user.role, 'super_admin');
  pass('admin login and role');
  const adminToken = admin.data.token;
  let state;
  if (mode === 'before') {
    assert.ok(!fs.existsSync(stateFile), 'State file already exists; verify/clean earlier fixtures first');
    const stamp = String(Date.now());
    state = { base: BASE, stamp, adminToken,
      student: { name: 'Deployment Verification 0053', email: `deployment-0053-${stamp}@hostel.test`,
        password: crypto.randomBytes(18).toString('base64url'), roll_no: `D0053-${stamp}`, room_number: 'TEST-53' } };
    save(state);
    const hostel = await call('POST', '/hostels', { hostel_name: 'Deployment Verification Hostel ' + stamp, capacity: 10 }, adminToken);
    assert.equal(hostel.status, 201, hostel.data.error?.code);
    state.hostelId = hostel.data.hostel_id; state.student.hostel_id = state.hostelId; save(state);
    pass('admin creates a hostel');
    const registered = await call('POST', '/auth/register', state.student);
    assert.equal(registered.status, 201, registered.data.error?.code);
    state.studentId = registered.data.user.user_id; state.studentToken = registered.data.token; save(state);
    pass('student registration with unique roll number');
    const denied = await call('GET', '/dashboard/admin', null, state.studentToken);
    assert.equal(denied.status, 403);
    pass('student cannot open admin dashboard');
    const complaint = await call('POST', '/complaints', { category: 'Electricity',
      description: 'Deployment verification: exposed wire sparking in room TEST-53. Urgent inspection.' }, state.studentToken);
    assert.equal(complaint.status, 201, complaint.data.error?.code);
    state.complaintId = complaint.data.complaint_id; save(state);
    assert.equal(complaint.data.priority, 'Critical'); assert.equal(complaint.data.sla_hours, 2);
    pass('complaint creation and server-generated Critical priority / 2-hour SLA');
    const duplicate = await call('POST', '/complaints/duplicates/check', { category: 'Electricity',
      description: 'Deployment verification: exposed wire sparking in room TEST-53. Urgent inspection.' }, state.studentToken);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.possible_duplicate, true);
    assert.ok(duplicate.data.matches.some((row) => row.complaint_id === state.complaintId));
    pass('duplicate detection finds the matching complaint');
    const hotspots = await call('GET', '/dashboard/admin/hotspots?days=30', null, adminToken);
    assert.equal(hotspots.status, 200);
    assert.ok(hotspots.data.locations.some((row) => row.hostel_id === state.hostelId && row.room_number === 'TEST-53'));
    pass('hotspot analytics includes the registered room');
    const resolved = await call('PATCH', `/complaints/${state.complaintId}/status`,
      { status: 'Resolved', admin_remarks: 'Deployment acceptance test only; no real maintenance claim.' }, adminToken);
    assert.equal(resolved.status, 200); assert.equal(resolved.data.sla_state, 'met');
    pass('staff status update and SLA-met result');
  } else {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.base, BASE);
    const login = await call('POST', '/auth/login', { email: state.student.email, password: state.student.password });
    assert.equal(login.status, 200, login.data.error?.code);
    assert.equal(login.data.user.roll_no, state.student.roll_no);
    assert.equal(login.data.user.user_id, state.studentId);
    pass('same student account logs in after redeploy');
    const profile = await call('GET', '/users/me', null, state.studentToken);
    assert.equal(profile.status, 200); assert.equal(profile.data.user_id, state.studentId);
    pass('pre-redeploy student token still authenticates (stable JWT secret)');
    const stored = await call('GET', '/complaints/' + state.complaintId, null, login.data.token);
    assert.equal(stored.status, 200); assert.equal(stored.data.status, 'Resolved');
    assert.equal(stored.data.priority, 'Critical'); assert.equal(stored.data.sla_state, 'met');
    pass('same resolved complaint, priority and SLA survive redeploy');
    const oldAdmin = await call('GET', '/dashboard/admin', null, state.adminToken);
    assert.equal(oldAdmin.status, 200);
    pass('pre-redeploy admin token still authenticates');
  }
  const dashboard = await call('GET', '/dashboard/admin', null, adminToken);
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.data.totalComplaints >= 1);
  assert.ok(dashboard.data.activity.resolvedTotal >= 1);
  pass('admin dashboard raised/resolved statistics');
  const invalid = await call('POST', '/auth/login', { email: admin.data.user.email, password: 'invalid-test-only' });
  assert.equal(invalid.status, 401); assert.equal(invalid.data.error.code, 'INVALID_CREDENTIALS');
  pass('incorrect password rejected');
  console.log('Live acceptance mode complete: ' + mode);
})().catch((err) => { console.error('FAIL:', err.message); process.exitCode = 1; });
