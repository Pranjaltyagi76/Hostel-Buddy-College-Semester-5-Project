// Phase 2 integration test — student complaint lifecycle.
// Run the whole suite with:  npm test  (starts its own server + database)
// Or on its own against a server you started yourself:  npm run test:complaints
const BASE = process.env.HB_TEST_BASE || 'http://localhost:4000/api';
// Same server, without the /api prefix — used to fetch an uploaded image.
const ORIGIN = BASE.replace(/\/api$/, '');
let pass = 0, fail = 0;

// A 1x1 transparent PNG, used to test real multipart image upload.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function upload(method, path, { token, fields, file }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  if (file) fd.append('image', new Blob([file.buf], { type: file.type }), file.name);
  const res = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${token}` }, body: fd });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name} ${detail}`); fail++; }
}

// Every student now needs a roll number and a hostel to register.
async function registerStudent(tag, hostelId) {
  const uniq = `${tag}${Date.now()}`;
  const r = await call('POST', '/auth/register', {
    body: {
      name: `Student ${tag}`,
      email: `c${uniq}@hostel.test`,
      password: 'secret123',
      roll_no: `C${uniq}`,
      hostel_id: hostelId,
      room_number: 'A-1',
    },
  });
  return r.data.token;
}

(async () => {
  // Both students share a hostel so the complaints they raise land in one place.
  const hostelId = (await call('GET', '/hostels')).data[0].hostel_id;
  const tokenA = await registerStudent('A', hostelId);
  const tokenB = await registerStudent('B', hostelId);
  const admin = await call('POST', '/auth/login', { body: { email: 'admin@hostel.test', password: 'admin123' } });
  const adminToken = admin.data.token;

  console.log('\n1) Create complaint (no image)');
  let r = await call('POST', '/complaints', { token: tokenA, body: { category: 'Wi-Fi', description: 'No signal in A-1' } });
  check('returns 201', r.status === 201, `(got ${r.status})`);
  check('status is Pending', r.data?.status === 'Pending');
  check('image_url is null', r.data?.image_url === null);
  const c1 = r.data?.complaint_id;

  console.log('\n2) Create complaint WITH image (multipart)');
  r = await upload('POST', '/complaints', { token: tokenA, fields: { category: 'Plumbing', description: 'Leaking tap' }, file: { buf: PNG_1x1, type: 'image/png', name: 't.png' } });
  check('returns 201', r.status === 201, `(got ${r.status})`);
  check('image_url set under /uploads', typeof r.data?.image_url === 'string' && r.data.image_url.startsWith('/uploads/'));
  const c2 = r.data?.complaint_id;
  const c2img = r.data?.image_url;

  console.log('\n3) Uploaded image is served');
  if (c2img) {
    const res = await fetch(ORIGIN + c2img);
    check('image GET 200', res.status === 200, `(got ${res.status})`);
  } else check('image GET 200', false, '(no image url)');

  console.log('\n4) Validation');
  r = await call('POST', '/complaints', { token: tokenA, body: { category: 'NotACategory', description: 'x' } });
  check('bad category -> 400', r.status === 400, `(got ${r.status})`);
  r = await call('POST', '/complaints', { token: tokenA, body: { category: 'Cleaning', description: '   ' } });
  check('empty description -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n5) Reject unsupported file type');
  r = await upload('POST', '/complaints', { token: tokenA, fields: { category: 'Other', description: 'bad file' }, file: { buf: Buffer.from('hello'), type: 'text/plain', name: 'x.txt' } });
  check('text file -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n6) List my complaints');
  r = await call('GET', '/complaints/mine', { token: tokenA });
  check('returns array', Array.isArray(r.data));
  check('has 2 complaints', r.data?.length === 2, `(got ${r.data?.length})`);

  console.log('\n7) Admin (not owner) can NOT create, student-only');
  r = await call('POST', '/complaints', { token: adminToken, body: { category: 'Wi-Fi', description: 'admin try' } });
  check('admin create -> 403', r.status === 403, `(got ${r.status})`);

  console.log('\n8) Ownership: student B cannot view/edit A\'s complaint');
  r = await call('GET', `/complaints/${c1}`, { token: tokenB });
  check('B view A -> 403', r.status === 403, `(got ${r.status})`);
  r = await call('PUT', `/complaints/${c1}`, { token: tokenB, body: { description: 'hacked' } });
  check('B edit A -> 403', r.status === 403, `(got ${r.status})`);

  console.log('\n9) Owner can view + admin can view');
  r = await call('GET', `/complaints/${c1}`, { token: tokenA });
  check('A view own -> 200', r.status === 200, `(got ${r.status})`);
  r = await call('GET', `/complaints/${c1}`, { token: adminToken });
  check('admin view -> 200', r.status === 200, `(got ${r.status})`);

  console.log('\n10) Edit own Pending complaint');
  r = await call('PUT', `/complaints/${c1}`, { token: tokenA, body: { category: 'Electricity', description: 'Fan not working' } });
  check('edit -> 200', r.status === 200, `(got ${r.status})`);
  check('category updated', r.data?.category === 'Electricity');
  check('description updated', r.data?.problem_description === 'Fan not working');

  console.log('\n11) Pending-guard: flip status to In Progress, then edit/delete blocked');
  // Advance the complaint the way the application actually does it — through
  // the admin endpoint. Writing to the database file directly would couple this
  // integration test to one specific database path.
  r = await call('PATCH', `/complaints/${c1}/status`, { token: adminToken, body: { status: 'In Progress' } });
  check('admin advanced it to In Progress', r.status === 200, `(got ${r.status})`);
  r = await call('PUT', `/complaints/${c1}`, { token: tokenA, body: { description: 'too late' } });
  check('edit non-Pending -> 409', r.status === 409, `(got ${r.status})`);
  check('code NOT_PENDING', r.data?.error?.code === 'NOT_PENDING');
  r = await call('DELETE', `/complaints/${c1}`, { token: tokenA });
  check('delete non-Pending -> 409', r.status === 409, `(got ${r.status})`);

  console.log('\n12) Delete own Pending complaint');
  r = await call('DELETE', `/complaints/${c2}`, { token: tokenA });
  check('delete -> 200', r.status === 200, `(got ${r.status})`);
  r = await call('GET', `/complaints/${c2}`, { token: tokenA });
  check('deleted complaint -> 404', r.status === 404, `(got ${r.status})`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
