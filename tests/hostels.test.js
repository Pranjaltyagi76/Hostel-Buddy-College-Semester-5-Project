// Hostel management and manager provisioning — super-admin capabilities.
// Run the whole suite with:  npm test  (starts its own server + database)
// Or on its own against a server you started yourself:  npm run test:hostels
const BASE = process.env.HB_TEST_BASE || 'http://localhost:4000/api';
let pass = 0, fail = 0;

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name} ${detail}`); fail++; }
}

const login = async (email, password) =>
  (await call('POST', '/auth/login', { body: { email, password } })).data?.token;

(async () => {
  const uniq = Date.now();
  const superToken = await login('admin@hostel.test', 'admin123');
  const managerToken = await login('manager.aryabhatta@hostel.test', 'manager123');

  // A student of our own, so the suite never depends on seed state.
  const hostels = (await call('GET', '/hostels')).data;
  const seedHostel = hostels[0];
  const reg = await call('POST', '/auth/register', {
    body: { name: 'Hostel Suite Student', email: `hs${uniq}@hostel.test`, password: 'secret123', roll_no: `HS${uniq}`, hostel_id: seedHostel.hostel_id },
  });
  const studentToken = reg.data?.token;

  console.log('\n1) Creating a hostel is super-admin only');
  const newHostel = { hostel_name: `Test Hostel ${uniq}`, location: 'West Campus', capacity: 120 };
  let r = await call('POST', '/hostels', { body: newHostel });
  check('no token -> 401', r.status === 401, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: studentToken, body: newHostel });
  check('student -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: managerToken, body: newHostel });
  check('MANAGER -> 403 (cannot redraw their own authority)', r.status === 403, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: superToken, body: newHostel });
  check('super admin -> 201', r.status === 201, `(got ${r.status})`);
  check('name stored', r.data?.hostel_name === newHostel.hostel_name);
  check('location stored', r.data?.location === 'West Campus');
  check('capacity stored', r.data?.capacity === 120);
  const created = r.data;

  console.log('\n2) Create validation');
  r = await call('POST', '/hostels', { token: superToken, body: newHostel });
  check('duplicate name -> 409', r.status === 409 && r.data?.error?.code === 'HOSTEL_NAME_TAKEN', `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: superToken, body: { hostel_name: '' } });
  check('empty name -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: superToken, body: { hostel_name: { a: 1 } } });
  check('name of wrong type -> 400 (not coerced)', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: superToken, body: { hostel_name: `Zero Cap ${uniq}`, capacity: 0 } });
  check('capacity 0 -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: superToken, body: { hostel_name: `Bad Cap ${uniq}`, capacity: 'many' } });
  check('non-numeric capacity -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/hostels', { token: superToken, body: { hostel_name: `Minimal ${uniq}` } });
  check('name only (no location/capacity) -> 201', r.status === 201, `(got ${r.status})`);
  const minimal = r.data;

  console.log('\n3) The new hostel appears in the public list');
  r = await call('GET', '/hostels');
  check('listed without a token', r.data.some((h) => h.hostel_id === created.hostel_id));

  console.log('\n4) Updating a hostel');
  r = await call('PUT', `/hostels/${created.hostel_id}`, { token: managerToken, body: { hostel_name: 'Hijacked' } });
  check('manager -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('PUT', `/hostels/${created.hostel_id}`, {
    token: superToken, body: { hostel_name: `Renamed Hostel ${uniq}`, location: 'North Wing', capacity: 300 },
  });
  check('super admin -> 200', r.status === 200, `(got ${r.status})`);
  check('name updated', r.data?.hostel_name === `Renamed Hostel ${uniq}`);
  check('capacity updated', r.data?.capacity === 300);
  r = await call('PUT', `/hostels/${created.hostel_id}`, { token: superToken, body: { hostel_name: minimal.hostel_name } });
  check('renaming onto another hostel -> 409', r.status === 409, `(got ${r.status})`);
  r = await call('PUT', '/hostels/999999', { token: superToken, body: { hostel_name: 'Ghost' } });
  check('unknown hostel -> 404', r.status === 404, `(got ${r.status})`);

  console.log('\n5) Deleting an empty hostel');
  r = await call('DELETE', `/hostels/${minimal.hostel_id}`, { token: managerToken });
  check('manager -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('DELETE', `/hostels/${minimal.hostel_id}`, { token: superToken });
  check('super admin -> 200', r.status === 200, `(got ${r.status})`);
  r = await call('GET', '/hostels');
  check('gone from the list', !r.data.some((h) => h.hostel_id === minimal.hostel_id));

  console.log('\n6) A hostel still in use cannot be deleted');
  r = await call('DELETE', `/hostels/${seedHostel.hostel_id}`, { token: superToken });
  check('occupied hostel -> 409', r.status === 409, `(got ${r.status})`);
  check('code HOSTEL_IN_USE', r.data?.error?.code === 'HOSTEL_IN_USE');
  check('message names what is blocking it', /student|manager|complaint/i.test(r.data?.error?.message || ''));
  r = await call('GET', '/hostels');
  check('hostel still exists after the refusal', r.data.some((h) => h.hostel_id === seedHostel.hostel_id));

  console.log('\n7) Provisioning a manager is super-admin only');
  const newManager = { name: 'New Manager', email: `mgr${uniq}@hostel.test`, password: 'manager123', hostel_id: created.hostel_id };
  r = await call('POST', '/users/managers', { token: studentToken, body: newManager });
  check('student -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('POST', '/users/managers', { token: managerToken, body: newManager });
  check('MANAGER cannot create another manager -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('POST', '/users/managers', { token: superToken, body: newManager });
  check('super admin -> 201', r.status === 201, `(got ${r.status})`);
  check('role is manager', r.data?.role === 'manager');
  check('bound to the hostel', r.data?.hostel_id === created.hostel_id);
  check('no password hash exposed', r.data?.password_hash === undefined);
  check('manager has no roll number', r.data?.roll_no === null);

  console.log('\n8) The provisioned manager can log in and is correctly scoped');
  const freshToken = await login(newManager.email, newManager.password);
  check('can log in', !!freshToken);
  r = await call('GET', '/users', { token: freshToken });
  check('sees the student list -> 200', r.status === 200, `(got ${r.status})`);
  check('sees no students (their hostel is empty)', Array.isArray(r.data) && r.data.length === 0, `(got ${r.data?.length})`);

  console.log('\n9) Manager creation validation');
  r = await call('POST', '/users/managers', { token: superToken, body: newManager });
  check('duplicate email -> 409', r.status === 409, `(got ${r.status})`);
  r = await call('POST', '/users/managers', { token: superToken, body: { ...newManager, email: `m2${uniq}@h.test`, hostel_id: 99999 } });
  check('unknown hostel -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/users/managers', { token: superToken, body: { ...newManager, email: `m3${uniq}@h.test`, hostel_id: undefined } });
  check('missing hostel -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/users/managers', { token: superToken, body: { ...newManager, email: `m4${uniq}@h.test`, password: '123' } });
  check('weak password -> 400 (same policy as registration)', r.status === 400, `(got ${r.status})`);

  console.log('\n10) Listing managers is super-admin only');
  r = await call('GET', '/users/managers', { token: managerToken });
  check('manager -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('GET', '/users/managers', { token: superToken });
  check('super admin -> 200', r.status === 200, `(got ${r.status})`);
  check('all listed are managers', Array.isArray(r.data) && r.data.every((m) => m.role === 'manager'));
  check('each carries its hostel', r.data.every((m) => m.hostel_id !== null));
  check('no password hashes', r.data.every((m) => m.password_hash === undefined));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
