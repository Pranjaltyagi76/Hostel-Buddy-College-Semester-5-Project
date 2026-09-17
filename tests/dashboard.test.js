// Phase 4 integration test — dashboards & analytics.
// Self-contained: creates its own student and complaints, and asserts
// invariants + deltas rather than absolute seed counts, so it can run in any
// order against a running server.
//   npm test   (starts its own server + database), or, against a server you
//   started yourself, npm run test:dashboard
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
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const ALL_STATUSES = ['Pending', 'In Progress', 'Resolved', 'Closed'];
const ALL_CATEGORIES = ['Electricity','Plumbing','Water Supply','Wi-Fi','Cleaning','Furniture','Security','Other'];
const ALL_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const ALL_SLA_STATES = ['on_track', 'overdue', 'met', 'missed'];

(async () => {
  const adminToken = await login('admin@hostel.test', 'admin123');

  // Snapshot admin totals BEFORE we add anything, so the deltas below are exact.
  const before = (await call('GET', '/dashboard/admin', { token: adminToken })).data;

  // A brand-new student => dashboard starts empty, independent of seed state.
  const email = `dash${Date.now()}@hostel.test`;
  const hostelId = (await call('GET', '/hostels')).data[0].hostel_id;
  const reg = await call('POST', '/auth/register', { body: { name: 'Dash Tester', email, password: 'secret123', roll_no: `DS${Date.now()}`, hostel_id: hostelId, room_number: 'Z-9' } });
  const studentToken = reg.data.token;

  console.log('\n1) Fresh student dashboard is all zeros');
  let r = await call('GET', '/dashboard/student', { token: studentToken });
  check('returns 200', r.status === 200, `(got ${r.status})`);
  check('total 0', r.data?.total === 0, `(got ${r.data?.total})`);
  check('all buckets 0', r.data.pending === 0 && r.data.inProgress === 0 && r.data.resolved === 0 && r.data.closed === 0);

  console.log('\n2) Admin dashboard invariants + delta from 1 student and 3 complaints');
  // create 3 complaints (all start Pending)
  await call('POST', '/complaints', { token: studentToken, body: { category: 'Wi-Fi', description: 'c1' } });
  await call('POST', '/complaints', { token: studentToken, body: { category: 'Cleaning', description: 'c2' } });
  await call('POST', '/complaints', { token: studentToken, body: { category: 'Security', description: 'c3' } });
  const after = (await call('GET', '/dashboard/admin', { token: adminToken })).data;

  check('byStatus has all 4 statuses', ALL_STATUSES.every(s => s in after.byStatus));
  check('byCategory has all 8 categories', ALL_CATEGORIES.every(c => c in after.byCategory));
  check('byStatus sums to totalComplaints', sum(after.byStatus) === after.totalComplaints, `(${sum(after.byStatus)} vs ${after.totalComplaints})`);
  check('byCategory sums to totalComplaints', sum(after.byCategory) === after.totalComplaints, `(${sum(after.byCategory)} vs ${after.totalComplaints})`);
  check('byPriority has all 4 priorities', ALL_PRIORITIES.every(priority => priority in after.byPriority));
  check('byPriority sums to totalComplaints', sum(after.byPriority) === after.totalComplaints);
  check('SLA summary has all 4 states', ALL_SLA_STATES.every(state => state in after.sla));
  check('SLA summary sums to totalComplaints', sum(after.sla) === after.totalComplaints);
  check('totalComplaints increased by exactly 3', after.totalComplaints === before.totalComplaints + 3, `(${before.totalComplaints} -> ${after.totalComplaints})`);
  check('totalStudents increased by exactly 1', after.totalStudents === before.totalStudents + 1, `(${before.totalStudents} -> ${after.totalStudents})`);
  check('super admin activity has 30 daily points', after.activity?.periodDays === 30 && after.activity.daily?.length === 30);
  check('activity days are chronological', after.activity.daily.every((x, i, a) => i === 0 || a[i - 1].day < x.day));
  check('raised activity total matches daily values', after.activity.raisedTotal === after.activity.daily.reduce((n, x) => n + x.raised, 0));
  check('resolved activity total matches daily values', after.activity.resolvedTotal === after.activity.daily.reduce((n, x) => n + x.resolved, 0));
  check('three new complaints appear in raised activity', after.activity.raisedTotal === before.activity.raisedTotal + 3,
    `(${before.activity.raisedTotal} -> ${after.activity.raisedTotal})`);

  console.log('\n3) totalStudents matches the admin student list length');
  const users = (await call('GET', '/users', { token: adminToken })).data;
  check('totalStudents === /users length', after.totalStudents === users.length, `(${after.totalStudents} vs ${users.length})`);

  console.log('\n4) recent complaints: newest-first, capped at 5, with student info');
  check('recent is array (<=5)', Array.isArray(after.recent) && after.recent.length <= 5);
  check('recent rows include student_name', after.recent.every(x => x.student_name !== undefined));
  check('recent is newest-first', after.recent.every((x, i, a) => i === 0 || a[i-1].created_at >= x.created_at));

  console.log('\n5) Complaint hotspot analytics is ranked, actionable, and scoped');
  r = await call('GET', '/dashboard/admin/hotspots', { token: adminToken });
  check('hotspot endpoint returns 200', r.status === 200, `(got ${r.status})`);
  check('default hotspot window is 30 days', r.data?.period_days === 30 && r.data?.comparison_days === 30);
  check('hotspot summary covers locations and complaints',
    r.data?.summary?.locations >= 1 && r.data?.summary?.complaints >= 3);
  const ownHotspot = r.data?.locations?.find(x => x.hostel_id === hostelId && x.room_number === 'Z-9');
  check('three complaints form a room-level hotspot', ownHotspot?.complaint_count === 3);
  check('hotspot identifies a dominant category',
    ALL_CATEGORIES.includes(ownHotspot?.dominant_category) && ownHotspot?.dominant_category_count >= 1);
  check('volume and open work create a High risk score',
    ownHotspot?.risk_level === 'High' && ownHotspot?.risk_score >= 7);
  check('period-over-period trend marks the cluster as new',
    ownHotspot?.trend === 'new' && ownHotspot?.previous_count === 0 && ownHotspot?.change === 3);
  check('hotspot supplies an actionable recommendation',
    typeof ownHotspot?.recommended_action === 'string' && ownHotspot.recommended_action.length > 10);

  await call('PUT', '/users/me', {
    token: studentToken,
    body: { name: 'Dash Tester', room_number: 'Z-10' },
  });
  r = await call('GET', '/dashboard/admin/hotspots', { token: adminToken });
  check('changing profile room does not rewrite historical complaint locations',
    r.data?.locations?.some(x => x.hostel_id === hostelId && x.room_number === 'Z-9' && x.complaint_count === 3) &&
      !r.data.locations.some(x => x.hostel_id === hostelId && x.room_number === 'Z-10'));

  r = await call('GET', '/dashboard/admin/hotspots?days=7', { token: adminToken });
  check('supported 7-day window is accepted', r.status === 200 && r.data?.period_days === 7);
  r = await call('GET', '/dashboard/admin/hotspots?days=14', { token: adminToken });
  check('unsupported hotspot window is rejected', r.status === 400 && r.data?.error?.code === 'VALIDATION_ERROR');

  const managerAToken = await login('manager.aryabhatta@hostel.test', 'manager123');
  const managerBToken = await login('manager.ramanujan@hostel.test', 'manager123');
  r = await call('GET', '/dashboard/admin/hotspots', { token: managerAToken });
  check('manager hotspots contain only their hostel',
    r.status === 200 && r.data?.scope === 'managed_hostel' && r.data.locations.every(x => x.hostel_id === hostelId));
  r = await call('GET', '/dashboard/admin/hotspots', { token: managerBToken });
  check('another manager cannot see the new room hotspot',
    r.status === 200 && !r.data.locations.some(x => x.hostel_id === hostelId && x.room_number === 'Z-9'));
  r = await call('GET', '/dashboard/admin/hotspots', { token: studentToken });
  check('student -> hotspot analytics 403', r.status === 403, `(got ${r.status})`);
  r = await call('GET', '/dashboard/admin/hotspots');
  check('no token -> hotspot analytics 401', r.status === 401, `(got ${r.status})`);

  console.log('\n6) Student dashboard reflects the 3 new complaints');
  r = await call('GET', '/dashboard/student', { token: studentToken });
  check('total 3', r.data?.total === 3, `(got ${r.data?.total})`);
  check('pending 3', r.data?.pending === 3, `(got ${r.data?.pending})`);

  console.log('\n7) Student dashboard reflects admin status changes');
  const mine = (await call('GET', '/complaints/mine', { token: studentToken })).data;
  await call('PATCH', `/complaints/${mine[0].complaint_id}/status`, { token: adminToken, body: { status: 'In Progress' } });
  await call('PATCH', `/complaints/${mine[1].complaint_id}/status`, { token: adminToken, body: { status: 'Resolved' } });
  r = await call('GET', '/dashboard/student', { token: studentToken });
  check('total still 3', r.data?.total === 3, `(got ${r.data?.total})`);
  check('pending 1', r.data?.pending === 1, `(got ${r.data?.pending})`);
  check('inProgress 1', r.data?.inProgress === 1, `(got ${r.data?.inProgress})`);
  check('resolved 1', r.data?.resolved === 1, `(got ${r.data?.resolved})`);
  check('parts sum to total', (r.data.pending + r.data.inProgress + r.data.resolved + r.data.closed) === r.data.total);
  const activityAfterResolve = (await call('GET', '/dashboard/admin', { token: adminToken })).data.activity;
  check('new resolution appears in resolved activity', activityAfterResolve.resolvedTotal === after.activity.resolvedTotal + 1,
    `(${after.activity.resolvedTotal} -> ${activityAfterResolve.resolvedTotal})`);

  console.log('\n8) Guards');
  r = await call('GET', '/dashboard/admin', { token: studentToken });
  check('student -> admin dashboard 403', r.status === 403, `(got ${r.status})`);
  r = await call('GET', '/dashboard/student', { token: adminToken });
  check('admin -> student dashboard 403', r.status === 403, `(got ${r.status})`);
  r = await call('GET', '/dashboard/student');
  check('no token -> 401', r.status === 401, `(got ${r.status})`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
