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

// Video fixtures. The server identifies an upload by its leading bytes, so
// these carry the real container signatures — enough to drive every branch of
// the sniffer. They are headers, not playable footage; nothing decodes them.
const ascii = (text) => Buffer.from(text, 'latin1');

// An ISO base-media header: box size, "ftyp", then the major brand.
const mp4WithBrand = (brand) =>
  Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    ascii('ftyp'),
    ascii(brand),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    ascii('isomiso2avc1'),
  ]);

const MP4_HEADER = mp4WithBrand('isom');
// QuickTime shares the container but no browser here will play it.
const MOV_HEADER = mp4WithBrand('qt  ');

// EBML header, then the DocType that separates WebM from plain Matroska.
const ebmlWithDocType = (docType) =>
  Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]),
    Buffer.from([0x42, 0x82, 0x80 | docType.length]),
    ascii(docType),
    Buffer.alloc(16),
  ]);

const WEBM_HEADER = ebmlWithDocType('webm');
const MKV_HEADER = ebmlWithDocType('matroska');

// Just over the 5 MB image ceiling, but well under the 30 MB video ceiling
// Multer itself enforces — so only the per-field check can catch it.
const OVERSIZE_IMAGE = Buffer.concat([PNG_1x1, Buffer.alloc(6 * 1024 * 1024)]);

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// `file` attaches one image (the common case); `files` attaches an explicit
// list of { field, buf, type, name } so a request can carry both attachments,
// or put a file in the wrong field on purpose.
async function upload(method, path, { token, fields, file, files }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  const parts = files || (file ? [{ field: 'image', ...file }] : []);
  for (const p of parts) {
    fd.append(p.field, new Blob([p.buf], { type: p.type }), p.name);
  }
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
  check('video_url is null', r.data?.video_url === null);
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
  // The complaint carried an image; deleting the row must take the file with
  // it, or the uploads directory grows forever with unreferenced files.
  if (c2img) {
    const res = await fetch(ORIGIN + c2img);
    check('its uploaded image is gone -> 404', res.status === 404, `(got ${res.status})`);
  } else check('its uploaded image is gone -> 404', false, '(no image url)');

  console.log('\n13) Create complaint WITH video, and with both attachments');
  r = await upload('POST', '/complaints', {
    token: tokenA,
    fields: { category: 'Electricity', description: 'Light flickers every few seconds' },
    files: [{ field: 'video', buf: MP4_HEADER, type: 'video/mp4', name: 'clip.mp4' }],
  });
  check('video only -> 201', r.status === 201, `(got ${r.status})`);
  check('video_url set under /uploads', typeof r.data?.video_url === 'string' && r.data.video_url.startsWith('/uploads/'));
  check('image_url still null', r.data?.image_url === null);
  check('stored with a .mp4 extension', (r.data?.video_url || '').endsWith('.mp4'));
  const vidOnly = r.data?.complaint_id;
  const vidOnlyUrl = r.data?.video_url;

  r = await upload('POST', '/complaints', {
    token: tokenA,
    fields: { category: 'Plumbing', description: 'Tap drips overnight' },
    files: [
      { field: 'image', buf: PNG_1x1, type: 'image/png', name: 't.png' },
      { field: 'video', buf: WEBM_HEADER, type: 'video/webm', name: 'clip.webm' },
    ],
  });
  check('image + video -> 201', r.status === 201, `(got ${r.status})`);
  check('both urls set', typeof r.data?.image_url === 'string' && typeof r.data?.video_url === 'string');
  check('webm stored with a .webm extension', (r.data?.video_url || '').endsWith('.webm'));
  const bothId = r.data?.complaint_id;
  const bothImg = r.data?.image_url;
  const bothVid = r.data?.video_url;

  console.log('\n14) Uploaded video is served');
  if (vidOnlyUrl) {
    const res = await fetch(ORIGIN + vidOnlyUrl);
    check('video GET 200', res.status === 200, `(got ${res.status})`);
    check('served as video/mp4', (res.headers.get('content-type') || '').startsWith('video/mp4'));
  } else check('video GET 200', false, '(no video url)');

  console.log('\n15) A video is judged by its bytes, not its declared type');
  const badVideos = [
    ['a text file claiming to be MP4', Buffer.from('not a video at all'), 'video/mp4', 'fake.mp4'],
    ['a real PNG claiming to be MP4', PNG_1x1, 'video/mp4', 'fake.mp4'],
    ['QuickTime, which the player cannot show', MOV_HEADER, 'video/mp4', 'clip.mp4'],
    ['Matroska wearing a .webm name', MKV_HEADER, 'video/webm', 'clip.webm'],
  ];
  for (const [label, buf, type, name] of badVideos) {
    r = await upload('POST', '/complaints', {
      token: tokenA,
      fields: { category: 'Other', description: 'bad video' },
      files: [{ field: 'video', buf, type, name }],
    });
    check(`${label} -> 400`, r.status === 400, `(got ${r.status})`);
  }
  r = await upload('POST', '/complaints', {
    token: tokenA,
    fields: { category: 'Other', description: 'wrong declared type' },
    files: [{ field: 'video', buf: WEBM_HEADER, type: 'video/x-matroska', name: 'clip.mkv' }],
  });
  check('an unsupported declared type -> 400', r.status === 400, `(got ${r.status})`);

  console.log('\n16) Each field keeps its own kind and its own size limit');
  r = await upload('POST', '/complaints', {
    token: tokenA,
    fields: { category: 'Other', description: 'video in the image field' },
    files: [{ field: 'image', buf: MP4_HEADER, type: 'image/png', name: 'sneaky.png' }],
  });
  check('a video sent as the image -> 400', r.status === 400, `(got ${r.status})`);

  // Over the 5 MB image limit but under the 30 MB ceiling Multer enforces, so
  // this can only be caught by the per-field check that runs after the upload.
  r = await upload('POST', '/complaints', {
    token: tokenA,
    fields: { category: 'Other', description: 'huge image' },
    files: [{ field: 'image', buf: OVERSIZE_IMAGE, type: 'image/png', name: 'big.png' }],
  });
  check('a 6 MB image -> 400', r.status === 400, `(got ${r.status})`);
  check('code FILE_TOO_LARGE', r.data?.error?.code === 'FILE_TOO_LARGE', `(got ${r.data?.error?.code})`);

  console.log('\n17) Editing replaces and removes a video');
  r = await upload('PUT', `/complaints/${vidOnly}`, {
    token: tokenA,
    fields: { category: 'Electricity', description: 'Light flickers every few seconds' },
    files: [{ field: 'video', buf: WEBM_HEADER, type: 'video/webm', name: 'better.webm' }],
  });
  check('replace video -> 200', r.status === 200, `(got ${r.status})`);
  check('video_url changed', typeof r.data?.video_url === 'string' && r.data.video_url !== vidOnlyUrl);
  const replacedUrl = r.data?.video_url;
  if (vidOnlyUrl) {
    const res = await fetch(ORIGIN + vidOnlyUrl);
    check('the replaced file is deleted -> 404', res.status === 404, `(got ${res.status})`);
  } else check('the replaced file is deleted -> 404', false, '(no video url)');

  r = await upload('PUT', `/complaints/${vidOnly}`, {
    token: tokenA,
    fields: { description: 'Light flickers every few seconds', remove_video: 'true' },
  });
  check('remove_video -> 200', r.status === 200, `(got ${r.status})`);
  check('video_url cleared', r.data?.video_url === null, `(got ${r.data?.video_url})`);
  if (replacedUrl) {
    const res = await fetch(ORIGIN + replacedUrl);
    check('the removed file is deleted -> 404', res.status === 404, `(got ${res.status})`);
  } else check('the removed file is deleted -> 404', false, '(no video url)');

  console.log('\n18) Removing one attachment leaves the other alone');
  r = await upload('PUT', `/complaints/${bothId}`, {
    token: tokenA,
    fields: { description: 'Tap drips overnight', remove_image: 'true' },
  });
  check('remove_image -> 200', r.status === 200, `(got ${r.status})`);
  check('image_url cleared', r.data?.image_url === null);
  check('video_url untouched', r.data?.video_url === bothVid, `(got ${r.data?.video_url})`);
  if (bothImg) {
    const res = await fetch(ORIGIN + bothImg);
    check('only the image file is gone -> 404', res.status === 404, `(got ${res.status})`);
  } else check('only the image file is gone -> 404', false, '(no image url)');

  console.log('\n19) Deleting a complaint takes its video with it');
  r = await call('DELETE', `/complaints/${bothId}`, { token: tokenA });
  check('delete -> 200', r.status === 200, `(got ${r.status})`);
  if (bothVid) {
    const res = await fetch(ORIGIN + bothVid);
    check('its uploaded video is gone -> 404', res.status === 404, `(got ${res.status})`);
  } else check('its uploaded video is gone -> 404', false, '(no video url)');

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
