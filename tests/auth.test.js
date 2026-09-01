// Authentication and user integration test — the three-role model.
// Run the whole suite with:  npm test  (starts its own server + database)
// Or on its own against a server you started yourself:  npm run test:auth
const BASE = process.env.HB_TEST_BASE || 'http://localhost:4000/api';
let pass = 0, fail = 0;

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

  console.log('\n0) Hostels are listed publicly (the registration form needs them)');
  let r = await call('GET', '/hostels');
  check('returns 200 without a token', r.status === 200, `(got ${r.status})`);
  check('returns hostels', Array.isArray(r.data) && r.data.length >= 3, `(got ${r.data?.length})`);
  const hostels = r.data;
  const hostelA = hostels.find((h) => h.hostel_name === 'Aryabhatta Hostel');
  const hostelB = hostels.find((h) => h.hostel_name === 'Ramanujan Hostel');
  check('hostels carry name and location', !!hostelA && !!hostelA.location);

  const student = {
    name: 'Test Student',
    email: `stud${uniq}@hostel.test`,
    password: 'secret123',
    roll_no: `RN${uniq}`,
    hostel_id: hostelA.hostel_id,
    room_number: 'B-204',
  };

  console.log('\n1) Register a student');
  r = await call('POST', '/auth/register', { body: student });
  check('returns 201', r.status === 201, `(got ${r.status})`);
  check('returns a token', !!r.data?.token);
  check('role is student', r.data?.user?.role === 'student');
  check('roll number stored', r.data?.user?.roll_no === student.roll_no);
  check('hostel linked', r.data?.user?.hostel_id === hostelA.hostel_id);
  check('hostel name joined in', r.data?.user?.hostel_name === 'Aryabhatta Hostel');
  check('password hash NOT leaked', r.data?.user?.password_hash === undefined);
  const studentToken = r.data?.token;

  console.log('\n2) Registration validation');
  r = await call('POST', '/auth/register', { body: student });
  check('duplicate email -> 409 EMAIL_TAKEN', r.status === 409 && r.data?.error?.code === 'EMAIL_TAKEN', `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `dup${uniq}@h.test` } });
  check('duplicate roll number -> 409 ROLL_NO_TAKEN', r.status === 409 && r.data?.error?.code === 'ROLL_NO_TAKEN', `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `a${uniq}@h.test`, roll_no: `A${uniq}`, hostel_id: undefined } });
  check('missing hostel -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `b${uniq}@h.test`, roll_no: `B${uniq}`, hostel_id: 99999 } });
  check('unknown hostel -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `c${uniq}@h.test`, roll_no: '' } });
  check('missing roll number -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `d${uniq}@h.test`, roll_no: { a: 1 } } });
  check('roll number of wrong type -> 400 (not coerced)', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `e${uniq}@h.test`, roll_no: `E${uniq}`, password: '123' } });
  check('weak password -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n3) Login for all three roles');
  r = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
  check('student login -> 200 + token', r.status === 200 && !!r.data?.token, `(got ${r.status})`);
  r = await call('POST', '/auth/login', { body: { email: 'admin@hostel.test', password: 'admin123' } });
  check('super admin login -> 200', r.status === 200, `(got ${r.status})`);
  check('super admin role', r.data?.user?.role === 'super_admin');
  check('super admin has NO hostel (unscoped)', r.data?.user?.hostel_id === null);
  const superToken = r.data?.token;

  r = await call('POST', '/auth/login', { body: { email: 'manager.aryabhatta@hostel.test', password: 'manager123' } });
  check('manager login -> 200', r.status === 200, `(got ${r.status})`);
  check('manager role', r.data?.user?.role === 'manager');
  check('manager carries a hostel', r.data?.user?.hostel_id === hostelA.hostel_id, `(got ${r.data?.user?.hostel_id})`);
  const managerAToken = r.data?.token;
  const managerBToken = await login('manager.ramanujan@hostel.test', 'manager123');

  console.log('\n4) Login failures are generic');
  r = await call('POST', '/auth/login', { body: { email: student.email, password: 'wrongpass' } });
  check('wrong password -> 401', r.status === 401, `(got ${r.status})`);
  check('generic message (no user enumeration)', r.data?.error?.message === 'Invalid email or password');
  r = await call('POST', '/auth/login', { body: { email: `nobody${uniq}@h.test`, password: 'whatever' } });
  check('unknown email gives the SAME message', r.data?.error?.message === 'Invalid email or password');

  console.log('\n5) Session guards');
  r = await call('GET', '/users/me', { token: studentToken });
  check('own profile with token -> 200', r.status === 200, `(got ${r.status})`);
  check('profile shows roll number and hostel', r.data?.roll_no === student.roll_no && r.data?.hostel_name === 'Aryabhatta Hostel');
  r = await call('GET', '/users/me');
  check('no token -> 401', r.status === 401, `(got ${r.status})`);
  r = await call('GET', '/users/me', { token: 'garbage.token.value' });
  check('bad token -> 401', r.status === 401, `(got ${r.status})`);

  console.log('\n6) Profile update');
  r = await call('PUT', '/users/me', { token: studentToken, body: { name: 'Updated Name', room_number: 'C-101' } });
  check('update -> 200', r.status === 200, `(got ${r.status})`);
  check('name updated', r.data?.name === 'Updated Name');
  check('room updated', r.data?.room_number === 'C-101');
  check('roll number unchanged', r.data?.roll_no === student.roll_no);
  r = await call('PUT', '/users/me', { token: studentToken, body: { name: '' } });
  check('empty name -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n7) Student list is staff-only');
  r = await call('GET', '/users', { token: studentToken });
  check('student -> 403', r.status === 403, `(got ${r.status})`);
  check('code FORBIDDEN', r.data?.error?.code === 'FORBIDDEN');
  r = await call('GET', '/users', { token: superToken });
  check('super admin -> 200', r.status === 200, `(got ${r.status})`);
  check('list holds students only', Array.isArray(r.data) && r.data.every((u) => u.role === 'student'));
  check('no password hash exposed', r.data.every((u) => u.password_hash === undefined));
  const allStudents = r.data;

  console.log('\n8) MANAGER HOSTEL SCOPING — the core new rule');
  r = await call('GET', '/users', { token: managerAToken });
  check('manager -> 200', r.status === 200, `(got ${r.status})`);
  const seenByA = r.data;
  check('manager sees only their own hostel',
    seenByA.every((u) => u.hostel_id === hostelA.hostel_id),
    `(saw hostels ${[...new Set(seenByA.map((u) => u.hostel_id))].join(',')})`);
  check('manager sees FEWER students than the super admin',
    seenByA.length < allStudents.length,
    `(manager ${seenByA.length}, super admin ${allStudents.length})`);

  r = await call('GET', '/users', { token: managerBToken });
  const seenByB = r.data;
  check('a different manager sees a different hostel',
    seenByB.every((u) => u.hostel_id === hostelB.hostel_id),
    `(saw hostels ${[...new Set(seenByB.map((u) => u.hostel_id))].join(',')})`);
  const overlap = seenByA.filter((a) => seenByB.some((b) => b.user_id === a.user_id));
  check('the two managers share no students', overlap.length === 0, `(overlap ${overlap.length})`);
  check('together they see fewer than everyone (a third hostel exists)',
    seenByA.length + seenByB.length < allStudents.length);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
