// Phase 3 integration test — admin complaint management.
// Self-contained: creates its own student (with a unique name/room) and
// complaint, so it runs correctly in any order against a running server.
//   npm test   (starts its own server + database), or, against a server you
//   started yourself, npm run test:admin
const BASE = process.env.HB_TEST_BASE || 'http://localhost:4000/api';
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
  const hostelId = (await call('GET', '/hostels')).data[0].hostel_id;
  const reg = await call('POST', '/auth/register', { body: { name: uniqueName, email, password: PASS, roll_no: `AD${ts}`, hostel_id: hostelId, room_number: uniqueRoom } });
  const studentToken = reg.data.token;
  // one Wi-Fi complaint owned by this student
  const created = await call('POST', '/complaints', { token: studentToken, body: { category: 'Wi-Fi', description: 'Admin-flow test complaint' } });
  const cid = created.data.complaint_id;

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
  check('includes our complaint', r.data?.data?.some(c => c.complaint_id === cid));

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
  check('finds exactly our complaint', r.data?.data?.length === 1 && r.data.data[0].complaint_id === cid, `(got ${r.data?.data?.length})`);

  console.log('\n7) Search by (unique) room number');
  r = await call('GET', `/complaints?q=${encodeURIComponent(uniqueRoom)}`, { token: adminToken });
  check('finds our room', r.data?.data?.length === 1 && r.data.data[0].room_number === uniqueRoom, `(got ${r.data?.data?.length})`);

  console.log('\n8) Search by complaint id');
  r = await call('GET', `/complaints?q=${cid}`, { token: adminToken });
  check('finds the complaint by id', r.data?.data?.some(c => c.complaint_id === cid));

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
  const mine = r.data?.find(c => c.complaint_id === cid);
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

  // ------------------------------------------------------------------
  // Hostel scoping — a manager may only ever act within their own hostel.
  // Two students in two different hostels, each with a complaint, then every
  // staff operation is tried across the boundary.
  // ------------------------------------------------------------------
  console.log('\n15) HOSTEL SCOPING — a manager is confined to their own hostel');

  const allHostels = (await call('GET', '/hostels')).data;
  const hA = allHostels.find((h) => h.hostel_name === 'Aryabhatta Hostel');
  const hB = allHostels.find((h) => h.hostel_name === 'Ramanujan Hostel');
  const mgrA = await login('manager.aryabhatta@hostel.test', 'manager123');
  const mgrB = await login('manager.ramanujan@hostel.test', 'manager123');

  // A student and a complaint in each hostel.
  const mk = async (tag, hostelId) => {
    const u = `${tag}${ts}`;
    const reg = await call('POST', '/auth/register', {
      body: { name: `Scope ${tag}`, email: `sc${u}@hostel.test`, password: 'secret123', roll_no: `SC${u}`, hostel_id: hostelId },
    });
    const tok = reg.data.token;
    const c = await call('POST', '/complaints', { token: tok, body: { category: 'Wi-Fi', description: `scope test ${tag}` } });
    return { token: tok, complaintId: c.data.complaint_id, hostelId: c.data.hostel_id };
  };
  const inA = await mk('A', hA.hostel_id);
  const inB = await mk('B', hB.hostel_id);

  check('complaint inherits the student\'s hostel (not sent by the client)', inA.hostelId === hA.hostel_id, `(got ${inA.hostelId})`);
  check('the two complaints are in different hostels', inA.hostelId !== inB.hostelId);

  // Listing
  r = await call('GET', '/complaints?limit=100', { token: mgrA });
  check('manager A list contains their own complaint', r.data.data.some((c) => c.complaint_id === inA.complaintId));
  check('manager A list EXCLUDES the other hostel\'s complaint', !r.data.data.some((c) => c.complaint_id === inB.complaintId));
  check('every row manager A sees is their hostel', r.data.data.every((c) => c.hostel_id === hA.hostel_id));

  // Reading a single complaint across the boundary
  r = await call('GET', `/complaints/${inB.complaintId}`, { token: mgrA });
  check('manager A CANNOT read hostel B\'s complaint -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('GET', `/complaints/${inA.complaintId}`, { token: mgrA });
  check('manager A can read their own hostel\'s complaint -> 200', r.status === 200, `(got ${r.status})`);

  // Writing across the boundary — the one that really matters
  r = await call('PATCH', `/complaints/${inB.complaintId}/status`, { token: mgrA, body: { status: 'In Progress' } });
  check('manager A CANNOT change hostel B\'s complaint -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('GET', `/complaints/${inB.complaintId}`, { token: mgrB });
  check('and it really was left untouched', r.data?.status === 'Pending', `(got ${r.data?.status})`);

  r = await call('PATCH', `/complaints/${inA.complaintId}/status`, { token: mgrA, body: { status: 'In Progress' } });
  check('manager A CAN change their own hostel\'s complaint -> 200', r.status === 200, `(got ${r.status})`);

  // A search term must not be able to reach across the boundary either.
  r = await call('GET', `/complaints?q=${inB.complaintId}`, { token: mgrA });
  check('searching by the other hostel\'s complaint id finds nothing', !r.data.data.some((c) => c.complaint_id === inB.complaintId));

  // The super admin is unscoped.
  r = await call('GET', `/complaints/${inA.complaintId}`, { token: adminToken });
  check('super admin can read hostel A -> 200', r.status === 200, `(got ${r.status})`);
  r = await call('GET', `/complaints/${inB.complaintId}`, { token: adminToken });
  check('super admin can read hostel B -> 200', r.status === 200, `(got ${r.status})`);
  r = await call('PATCH', `/complaints/${inB.complaintId}/status`, { token: adminToken, body: { status: 'In Progress' } });
  check('super admin can act on either hostel -> 200', r.status === 200, `(got ${r.status})`);

  console.log('\n16) The staff dashboard is scoped the same way');
  const dashSuper = (await call('GET', '/dashboard/admin', { token: adminToken })).data;
  const dashA = (await call('GET', '/dashboard/admin', { token: mgrA })).data;
  check('super admin dashboard reports no scope', dashSuper.scope?.hostel_id === null);
  check('manager dashboard names their hostel', dashA.scope?.hostel_name === 'Aryabhatta Hostel', `(got ${dashA.scope?.hostel_name})`);
  check('manager sees fewer complaints than the super admin',
    dashA.totalComplaints < dashSuper.totalComplaints,
    `(manager ${dashA.totalComplaints}, super ${dashSuper.totalComplaints})`);
  check('manager sees fewer students than the super admin',
    dashA.totalStudents < dashSuper.totalStudents,
    `(manager ${dashA.totalStudents}, super ${dashSuper.totalStudents})`);
  check('scoped counts stay internally consistent',
    Object.values(dashA.byStatus).reduce((a, b) => a + b, 0) === dashA.totalComplaints);
  check('every recent row is the manager\'s own hostel',
    dashA.recent.every((c) => c.hostel_id === hA.hostel_id));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
