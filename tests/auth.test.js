// Phase 1 integration test — exercises auth + user endpoints end to end.
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

(async () => {
  const uniq = Date.now();
  const student = { name: 'Test Student', email: `stud${uniq}@hostel.test`, password: 'secret123', room_number: 'B-204' };

  console.log('\n1) Register student');
  let r = await call('POST', '/auth/register', { body: student });
  check('returns 201', r.status === 201, `(got ${r.status})`);
  check('returns a token', !!r.data?.token);
  check('user has student role', r.data?.user?.role === 'student');
  check('password hash NOT leaked', r.data?.user?.password_hash === undefined);
  const studentToken = r.data?.token;

  console.log('\n2) Duplicate email rejected');
  r = await call('POST', '/auth/register', { body: student });
  check('returns 409', r.status === 409, `(got ${r.status})`);
  check('code EMAIL_TAKEN', r.data?.error?.code === 'EMAIL_TAKEN');

  console.log('\n3) Weak password rejected');
  r = await call('POST', '/auth/register', { body: { ...student, email: `x${uniq}@h.test`, password: '123' } });
  check('returns 400', r.status === 400, `(got ${r.status})`);

  console.log('\n4) Login with correct credentials');
  r = await call('POST', '/auth/login', { body: { email: student.email, password: student.password } });
  check('returns 200 + token', r.status === 200 && !!r.data?.token, `(got ${r.status})`);

  console.log('\n5) Login with wrong password');
  r = await call('POST', '/auth/login', { body: { email: student.email, password: 'wrongpass' } });
  check('returns 401', r.status === 401, `(got ${r.status})`);
  check('generic message (no enumeration)', r.data?.error?.message === 'Invalid email or password');

  console.log('\n6) GET /users/me with token');
  r = await call('GET', '/users/me', { token: studentToken });
  check('returns 200', r.status === 200, `(got ${r.status})`);
  check('correct email', r.data?.email === student.email);

  console.log('\n7) GET /users/me without token');
  r = await call('GET', '/users/me');
  check('returns 401', r.status === 401, `(got ${r.status})`);

  console.log('\n8) GET /users/me with bad token');
  r = await call('GET', '/users/me', { token: 'garbage.token.value' });
  check('returns 401', r.status === 401, `(got ${r.status})`);

  console.log('\n9) PUT /users/me updates profile');
  r = await call('PUT', '/users/me', { token: studentToken, body: { name: 'Updated Name', room_number: 'C-101' } });
  check('returns 200', r.status === 200, `(got ${r.status})`);
  check('name updated', r.data?.name === 'Updated Name');
  check('room updated', r.data?.room_number === 'C-101');

  console.log('\n10) Student CANNOT list all users (admin only)');
  r = await call('GET', '/users', { token: studentToken });
  check('returns 403', r.status === 403, `(got ${r.status})`);
  check('code FORBIDDEN', r.data?.error?.code === 'FORBIDDEN');

  console.log('\n11) Admin login + list students');
  r = await call('POST', '/auth/login', { body: { email: 'admin@hostel.test', password: 'admin123' } });
  check('admin login 200', r.status === 200, `(got ${r.status})`);
  check('admin role', r.data?.user?.role === 'admin');
  const adminToken = r.data?.token;
  r = await call('GET', '/users', { token: adminToken });
  check('admin lists users 200', r.status === 200, `(got ${r.status})`);
  check('list is an array with students', Array.isArray(r.data) && r.data.length >= 1);
  check('admin not in student list', Array.isArray(r.data) && r.data.every(u => u.role === 'student'));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
