// Phase 3 integration test — admin complaint management.
// Self-contained: creates its own student (with a unique name/room) and
// complaint, so it runs correctly in any order against a running server.
//   npm start   (another terminal)   then   npm run test:admin
const BASE = 'http://localhost:4000/api';
let pass = 0, fail = 0;

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name} ${detail}`); fail++; }
}

const login = async (email, password) =>
  (await call('POST', '/auth/login', { body: { email, password } })).data?.token;

(async () => {
  const adminToken = await login('admin@hostel.test', 'admin123');

  // --- create our own isolated student + complaint ---
  const ts = Date.now();
  const uniqueName = `Zeta Searchcase ${ts}`;
  const uniqueRoom = `SR-${ts}`;
  const email = `admflow${ts}@hostel.test`;
  const PASS = 'secret123';
  const reg = await call('POST', '/auth/register', { body: { name: uniqueName, email, password: PASS, room_number: uniqueRoom } });
  const studentToken = reg.data.token;
  // one Wi-Fi complaint owned by this student
  const created = await call('POST', '/complaints', { token: studentToken, body: { category: 'Wi-Fi', description: 'Admin-flow test complaint' } });
  const cid = created.data.id;

  console.log('\n1) Admin lists all complaints');
  let r = await call('GET', '/complaints', { token: adminToken });
  check('returns 200', r.status === 200, `(got ${r.status})`);
  check('has data array', Array.isArray(r.data?.data));
  check('has pagination', typeof r.data?.pagination?.total === 'number');
  check('rows include student_name + room', r.data?.data?.[0]?.student_name !== undefined && r.data?.data?.[0]?.room_number !== undefined);
  const total = r.data?.pagination?.total;

  console.log('\n2) Student CANNOT use admin list');
  r = await call('GET', '/complaints', { token: studentToken });
  check('returns 403', r.status === 403, `(got ${r.status})`);

  console.log('\n3) Filter by status = Pending (our complaint is Pending)');
  r = await call('GET', '/complaints?status=Pending', { token: adminToken });
  check('all rows are Pending', r.data?.data?.every(c => c.status === 'Pending'), '(mismatch)');
  check('includes our complaint', r.data?.data?.some(c => c.id === cid));

  console.log('\n4) Filter by category = Wi-Fi');
  r = await call('GET', '/complaints?category=Wi-Fi', { token: adminToken });
  check('all rows are Wi-Fi', r.data?.data?.every(c => c.category === 'Wi-Fi'), '(mismatch)');

  console.log('\n5) Invalid filters rejected');
  r = await call('GET', '/complaints?status=Nope', { token: adminToken });
  check('bad status -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('GET', '/complaints?category=Nope', { token: adminToken });
  check('bad category -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n6) Search by (unique) student name');
  r = await call('GET', `/complaints?q=${encodeURIComponent(uniqueName)}`, { token: adminToken });
  check('finds exactly our complaint', r.data?.data?.length === 1 && r.data.data[0].id === cid, `(got ${r.data?.data?.length})`);

  console.log('\n7) Search by (unique) room number');
  r = await call('GET', `/complaints?q=${encodeURIComponent(uniqueRoom)}`, { token: adminToken });
  check('finds our room', r.data?.data?.length === 1 && r.data.data[0].room_number === uniqueRoom, `(got ${r.data?.data?.length})`);

  console.log('\n8) Search by complaint id');
  r = await call('GET', `/complaints?q=${cid}`, { token: adminToken });
  check('finds the complaint by id', r.data?.data?.some(c => c.id === cid));

  console.log('\n9) Pagination');
  r = await call('GET', '/complaints?limit=5&page=1', { token: adminToken });
  check('returns <= 5 rows', r.data?.data?.length <= 5, `(got ${r.data?.data?.length})`);
  check('limit echoed as 5', r.data?.pagination?.limit === 5);
  check('totalPages computed', r.data?.pagination?.totalPages === Math.max(1, Math.ceil(total / 5)));

  console.log('\n10) Status lifecycle on our Pending complaint');
  r = await call('PATCH', `/complaints/${cid}/status`, { token: adminToken, body: { status: 'In Progress', admin_remarks: 'Technician assigned.' } });
  check('-> In Progress 200', r.status === 200, `(got ${r.status})`);
  check('status updated', r.data?.status === 'In Progress');
  check('remarks saved', r.data?.admin_remarks === 'Technician assigned.');
  check('resolved_at still null', r.data?.resolved_at === null);

  console.log('\n11) Student sees the update + can no longer edit');
  r = await call('GET', '/complaints/mine', { token: studentToken });
  const mine = r.data?.find(c => c.id === cid);
  check('student sees In Progress', mine?.status === 'In Progress');
  check('student sees remarks', mine?.admin_remarks === 'Technician assigned.');
  r = await call('PUT', `/complaints/${cid}`, { token: studentToken, body: { description: 'too late' } });
  check('student edit now blocked (409)', r.status === 409, `(got ${r.status})`);

  console.log('\n12) Resolve sets resolved_at (once)');
  r = await call('PATCH', `/complaints/${cid}/status`, { token: adminToken, body: { status: 'Resolved', admin_remarks: 'Fixed.' } });
  check('-> Resolved 200', r.status === 200, `(got ${r.status})`);
  check('resolved_at now set', typeof r.data?.resolved_at === 'string' && r.data.resolved_at.length > 0);
  const resolvedAt = r.data?.resolved_at;

  console.log('\n13) Close does NOT reset resolved_at');
  r = await call('PATCH', `/complaints/${cid}/status`, { token: adminToken, body: { status: 'Closed' } });
  check('-> Closed 200', r.status === 200, `(got ${r.status})`);
  check('resolved_at unchanged', r.data?.resolved_at === resolvedAt, `(was ${resolvedAt}, now ${r.data?.resolved_at})`);
  check('remarks preserved when omitted', r.data?.admin_remarks === 'Fixed.');

  console.log('\n14) Status validation & guards');
  r = await call('PATCH', `/complaints/${cid}/status`, { token: adminToken, body: { status: 'Foo' } });
  check('invalid status -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('PATCH', `/complaints/${cid}/status`, { token: adminToken, body: {} });
  check('missing status -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('PATCH', `/complaints/${cid}/status`, { token: studentToken, body: { status: 'Pending' } });
  check('student cannot change status -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('PATCH', `/complaints/999999/status`, { token: adminToken, body: { status: 'Pending' } });
  check('nonexistent complaint -> 404', r.status === 404, `(got ${r.status})`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
