// Regression test — one check per bug found in the code/runtime audit.
// Each block names the bug it locks down, so a future change that reintroduces
// one fails here with an obvious label.
//
// Run the whole suite with:  npm test  (starts its own server + database)
// Or on its own against a server you started yourself:  npm run test:regression
const BASE = process.env.HB_TEST_BASE || 'http://localhost:4000/api';
const ORIGIN = BASE.replace(/\/api$/, '');
let pass = 0, fail = 0;

// A real 1x1 transparent PNG, and a file that only claims to be one.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const NOT_AN_IMAGE = Buffer.from('<script>alert(1)</script>');

async function call(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

async function sendForm(method, path, fields, token) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v && v.blob) fd.append(k, v.blob, v.name);
    else fd.append(k, v);
  }
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name} ${detail}`); fail++; }
}

(async () => {
  const uniq = Date.now();
  const hostelId = (await call('GET', '/hostels')).data[0].hostel_id;
  const student = { name: 'Regression Student', email: `reg${uniq}@hostel.test`, password: 'secret123', roll_no: `RG${uniq}`, hostel_id: hostelId, room_number: 'R-1' };

  let r = await call('POST', '/auth/register', { body: student });
  const studentToken = r.data?.token;
  r = await call('POST', '/auth/login', { body: { email: 'admin@hostel.test', password: 'admin123' } });
  const adminToken = r.data?.token;

  // ---------------------------------------------------------------- BUG-01
  console.log('\nBUG-01) A non-string value is rejected, never coerced to "[object Object]"');
  r = await call('POST', '/auth/register', { body: { ...student, email: `obj${uniq}@h.test`, roll_no: `O1${uniq}`, name: { a: 1 } } });
  check('object as register name -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { ...student, email: `obj2${uniq}@h.test`, roll_no: `O2${uniq}`, room_number: { a: 1 } } });
  check('object as room_number -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/complaints', { token: studentToken, body: { category: 'Other', description: { a: 1 } } });
  check('object as description -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('PUT', '/users/me', { token: studentToken, body: { name: { a: 1 } } });
  check('object as profile name -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('GET', '/users/me', { token: studentToken });
  check('profile name never became "[object Object]"', r.data?.name === student.name, `(got ${r.data?.name})`);

  // ---------------------------------------------------------------- BUG-09
  console.log('\nBUG-09) Passwords past bcrypt\'s 72-byte limit are refused, not truncated');
  r = await call('POST', '/auth/register', { body: { name: 'Long', email: `long${uniq}@h.test`, password: 'A'.repeat(80), roll_no: `LN${uniq}`, hostel_id: hostelId } });
  check('80-character password -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/auth/register', { body: { name: 'Exact', email: `exact${uniq}@h.test`, password: 'A'.repeat(72), roll_no: `EX${uniq}`, hostel_id: hostelId } });
  check('72-character password still accepted -> 201', r.status === 201, `(got ${r.status})`);

  // ---------------------------------------------------------------- BUG-05
  console.log('\nBUG-05) An upload is identified by its bytes, not its declared type');
  r = await sendForm('POST', '/complaints', {
    category: 'Other',
    description: 'real image',
    image: { blob: new Blob([PNG_1x1], { type: 'image/png' }), name: 'ok.png' },
  }, studentToken);
  check('a genuine PNG is accepted -> 201', r.status === 201, `(got ${r.status})`);
  const withImage = r.data?.complaint_id;
  const imageUrl = r.data?.image_url;

  r = await sendForm('POST', '/complaints', {
    category: 'Other',
    description: 'spoofed',
    image: { blob: new Blob([NOT_AN_IMAGE], { type: 'image/png' }), name: 'evil.png' },
  }, studentToken);
  check('a text file labelled image/png -> 400', r.status === 400, `(got ${r.status})`);
  check('code INVALID_FILE_TYPE', r.data?.error?.code === 'INVALID_FILE_TYPE', `(got ${r.data?.error?.code})`);

  // ---------------------------------------------------------------- BUG-10
  console.log('\nBUG-10) A student can clear an attached image, not only replace it');
  r = await sendForm('PUT', `/complaints/${withImage}`, {
    category: 'Other',
    description: 'image removed',
    remove_image: 'true',
  }, studentToken);
  check('update with remove_image -> 200', r.status === 200, `(got ${r.status})`);
  check('image_url is now null', r.data?.image_url === null, `(got ${r.data?.image_url})`);
  if (imageUrl) {
    const res = await fetch(ORIGIN + imageUrl);
    check('the file is gone from disk -> 404', res.status === 404, `(got ${res.status})`);
  } else check('the file is gone from disk -> 404', false, '(no image url)');

  // ---------------------------------------------------------------- BUG-02
  console.log('\nBUG-02) The status lifecycle only moves forward (FR-14)');
  r = await call('POST', '/complaints', { token: studentToken, body: { category: 'Wi-Fi', description: 'lifecycle' } });
  const lc = r.data?.complaint_id;
  r = await call('PATCH', `/complaints/${lc}/status`, { token: adminToken, body: { status: 'Resolved' } });
  check('Pending -> Resolved allowed', r.status === 200, `(got ${r.status})`);
  check('resolved_at recorded', !!r.data?.resolved_at);
  const firstResolvedAt = r.data?.resolved_at;

  r = await call('PATCH', `/complaints/${lc}/status`, { token: adminToken, body: { status: 'Pending' } });
  check('Resolved -> Pending refused -> 409', r.status === 409, `(got ${r.status})`);
  check('code INVALID_TRANSITION', r.data?.error?.code === 'INVALID_TRANSITION', `(got ${r.data?.error?.code})`);

  r = await call('PATCH', `/complaints/${lc}/status`, { token: adminToken, body: { status: 'Resolved', admin_remarks: 'note only' } });
  check('same status allowed (remarks-only edit)', r.status === 200, `(got ${r.status})`);
  check('remarks saved', r.data?.admin_remarks === 'note only');
  check('resolved_at unchanged', r.data?.resolved_at === firstResolvedAt);

  r = await call('PATCH', `/complaints/${lc}/status`, { token: adminToken, body: { status: 'Closed' } });
  check('Resolved -> Closed allowed', r.status === 200, `(got ${r.status})`);
  r = await call('PATCH', `/complaints/${lc}/status`, { token: adminToken, body: { status: 'In Progress' } });
  check('Closed -> In Progress refused -> 409', r.status === 409, `(got ${r.status})`);

  r = await call('PATCH', `/complaints/${lc}/status`, { token: adminToken, body: { admin_remarks: { a: 1 }, status: 'Closed' } });
  check('object as admin_remarks -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n  no complaint can hold a resolution date while still open');
  r = await call('GET', '/complaints?limit=100', { token: adminToken });
  const inconsistent = (r.data?.data || []).filter(
    (c) => c.resolved_at && c.status !== 'Resolved' && c.status !== 'Closed'
  );
  check('zero rows are open-but-resolved', inconsistent.length === 0, `(found ${inconsistent.length})`);

  // ---------------------------------------------------------------- BUG-07
  console.log('\nBUG-07) LIKE wildcards in a search term are literal characters');
  const all = await call('GET', '/complaints?limit=100', { token: adminToken });
  const totalAll = all.data?.pagination?.total ?? 0;
  r = await call('GET', '/complaints?q=%25', { token: adminToken });
  check('q="%" does not match every row', r.data?.pagination?.total < totalAll, `(matched ${r.data?.pagination?.total} of ${totalAll})`);
  r = await call('GET', '/complaints?q=_', { token: adminToken });
  check('q="_" does not match every row', r.data?.pagination?.total < totalAll, `(matched ${r.data?.pagination?.total} of ${totalAll})`);
  r = await call('GET', `/complaints?q=${encodeURIComponent('Regression Student')}`, { token: adminToken });
  check('an ordinary name search still works', (r.data?.pagination?.total ?? 0) > 0);

  // ---------------------------------------------------------------- BUG-11
  console.log('\nBUG-11) A page number past the end is clamped, not echoed back');
  r = await call('GET', '/complaints?page=99999&limit=5', { token: adminToken });
  check('page never exceeds totalPages', r.data?.pagination?.page <= r.data?.pagination?.totalPages,
    `(page ${r.data?.pagination?.page} of ${r.data?.pagination?.totalPages})`);
  check('the clamped page still returns rows', (r.data?.data?.length ?? 0) > 0);

  // ---------------------------------------------------------------- BUG-06
  console.log('\nBUG-06) Framework internals never reach the client');
  r = await call('POST', '/auth/login', { raw: '{not json' });
  check('malformed JSON -> 400', r.status === 400, `(got ${r.status})`);
  check('no parser internals in the message',
    typeof r.data?.error?.message === 'string' && !/JSON at position|Unexpected token/i.test(r.data.error.message),
    `(got "${r.data?.error?.message}")`);
  check('code is one of ours', r.data?.error?.code === 'BAD_REQUEST', `(got ${r.data?.error?.code})`);

  r = await sendForm('POST', '/complaints', {
    category: 'Other',
    description: 'wrong field',
    photo: { blob: new Blob([PNG_1x1], { type: 'image/png' }), name: 'a.png' },
  }, studentToken);
  check('unexpected file field -> 400', r.status === 400, `(got ${r.status})`);
  check('message is written for a user', /image/i.test(r.data?.error?.message || ''), `(got "${r.data?.error?.message}")`);

  // ---------------------------------------------------------------- BUG-12
  console.log('\nBUG-12) An unknown page gets the app\'s own 404, not Express\'s');
  {
    const res = await fetch(ORIGIN + '/no-such-page', { headers: { Accept: 'text/html' } });
    const body = await res.text();
    check('returns 404', res.status === 404, `(got ${res.status})`);
    check('serves the Hostel Buddy 404 page', body.includes('Hostel Buddy') && !body.includes('<title>Error</title>'));
  }
  {
    const res = await fetch(BASE + '/nope');
    const body = await res.json().catch(() => null);
    check('an unknown API route still returns JSON', body?.error?.code === 'NOT_FOUND', `(got ${JSON.stringify(body)})`);
  }

  // ---------------------------------------------------------------- BUG-04
  console.log('\nBUG-04) The admin student list is reachable and admin-only (FR-17)');
  r = await call('GET', '/users', { token: adminToken });
  check('admin can list students -> 200', r.status === 200, `(got ${r.status})`);
  check('the list holds students only', Array.isArray(r.data) && r.data.every((u) => u.role === 'student'));
  check('no password hash is exposed', Array.isArray(r.data) && r.data.every((u) => u.password_hash === undefined));
  r = await call('GET', '/users', { token: studentToken });
  check('a student cannot list students -> 403', r.status === 403, `(got ${r.status})`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
