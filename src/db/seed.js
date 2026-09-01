'use strict';

// Demo seed script:  npm run seed
//
// Loads a realistic multi-hostel dataset so the dashboards, hostel scoping and
// admin views have something meaningful to show:
//
//   3 hostels
//   1 super admin  (unscoped — sees every hostel)
//   3 managers     (one per hostel — each sees only their own)
//   6 students     (spread across the three hostels)
//  13 complaints   (across categories, statuses and hostels)
//
// Safe to re-run: users are created only if their email is absent, and
// complaints are seeded only when the table is empty.
//
// Seeding writes SQL directly rather than going through the repositories,
// because creating a USER together with its subtype row is a data-layer
// concern and the repositories are rebuilt in Phase C.
const bcrypt = require('bcryptjs');
const { initSchema, db } = require('./index');
const { seedSuperAdmin } = require('./seedSuperAdmin');
const { ROLES } = require('../config/constants');

const STUDENT_PASSWORD = 'student123';
const MANAGER_PASSWORD = 'manager123';

// --- small helpers -------------------------------------------------------

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function findUserByEmail(email) {
  return db.prepare('SELECT user_id, role FROM user WHERE email = ?').get(email);
}

function insertUser(name, email, password, role) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email.toLowerCase(), hash, role);
  return Number(info.lastInsertRowid);
}

// --- hostels -------------------------------------------------------------

const HOSTELS = [
  { name: 'Aryabhatta Hostel', location: 'North Campus', capacity: 200 },
  { name: 'Ramanujan Hostel', location: 'South Campus', capacity: 180 },
  { name: 'Bhaskara Hostel', location: 'East Campus', capacity: 150 },
];

function ensureHostels() {
  const ids = {};
  for (const h of HOSTELS) {
    const found = db.prepare('SELECT hostel_id FROM hostel WHERE hostel_name = ?').get(h.name);
    if (found) {
      ids[h.name] = found.hostel_id;
      continue;
    }
    const info = db
      .prepare('INSERT INTO hostel (hostel_name, location, capacity) VALUES (?, ?, ?)')
      .run(h.name, h.location, h.capacity);
    ids[h.name] = Number(info.lastInsertRowid);
  }
  return ids;
}

// --- managers and students ----------------------------------------------

function ensureManager(name, email, hostelId) {
  const existing = findUserByEmail(email);
  if (existing) return existing.user_id;
  return inTransaction(() => {
    const userId = insertUser(name, email, MANAGER_PASSWORD, ROLES.MANAGER);
    db.prepare('INSERT INTO manager (user_id, hostel_id) VALUES (?, ?)').run(userId, hostelId);
    return userId;
  });
}

function ensureStudent(name, email, rollNo, hostelId, room) {
  const existing = findUserByEmail(email);
  if (existing) return existing.user_id;
  return inTransaction(() => {
    const userId = insertUser(name, email, STUDENT_PASSWORD, ROLES.STUDENT);
    db.prepare(
      'INSERT INTO student (user_id, roll_no, hostel_id, room_number) VALUES (?, ?, ?, ?)'
    ).run(userId, rollNo, hostelId, room);
    return userId;
  });
}

// --- complaints ----------------------------------------------------------

// Inserted with an explicit status and date, bypassing the service (which
// intentionally forces new complaints to Pending) so the demo data shows the
// whole lifecycle. hostel_id is taken from the student who raised it.
function seedComplaint({ studentId, hostelId, category, description, status, remarks = null, daysAgo = 0, resolvedDaysAgo = null }) {
  // daysAgo / resolvedDaysAgo are integers fixed in this file, so inlining them
  // into the datetime() modifiers is safe.
  const resolvedExpr = resolvedDaysAgo != null ? `datetime('now', '-${resolvedDaysAgo} days')` : 'NULL';
  db.prepare(
    `INSERT INTO complaint
       (student_id, hostel_id, category, problem_description, status, admin_remarks,
        created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?,
        datetime('now', '-${daysAgo} days'), datetime('now', '-${daysAgo} days'), ${resolvedExpr})`
  ).run(studentId, hostelId, category, description, status, remarks);
}

// --- main ----------------------------------------------------------------

function run() {
  initSchema();

  const hostel = ensureHostels();
  console.log(`[seed] ${HOSTELS.length} hostels ready.`);

  seedSuperAdmin();

  const arya = hostel['Aryabhatta Hostel'];
  const raman = hostel['Ramanujan Hostel'];
  const bhas = hostel['Bhaskara Hostel'];

  ensureManager('Suresh Menon', 'manager.aryabhatta@hostel.test', arya);
  ensureManager('Deepa Iyer', 'manager.ramanujan@hostel.test', raman);
  ensureManager('Vikram Bose', 'manager.bhaskara@hostel.test', bhas);
  console.log(`[seed] 3 managers ready (password: ${MANAGER_PASSWORD}).`);

  const rahul  = ensureStudent('Rahul Sharma', 'rahul@hostel.test',  '2024BCS1001', arya,  'B-204');
  const ananya = ensureStudent('Ananya Verma', 'ananya@hostel.test', '2024BCS1002', arya,  'A-112');
  const karan  = ensureStudent('Karan Nair',   'karan@hostel.test',  '2024BCS1003', raman, 'C-007');
  const priya  = ensureStudent('Priya Singh',  'priya@hostel.test',  '2024BCS1004', raman, 'B-210');
  const amit   = ensureStudent('Amit Kumar',   'amit@hostel.test',   '2024BCS1005', bhas,  'D-305');
  const sneha  = ensureStudent('Sneha Rao',    'sneha@hostel.test',  '2024BCS1006', bhas,  'D-110');
  console.log(`[seed] 6 students ready (password: ${STUDENT_PASSWORD}).`);

  const existing = db.prepare('SELECT COUNT(*) AS n FROM complaint').get().n;
  if (existing > 0) {
    console.log(`[seed] complaints already present (${existing}) — skipping complaint seed.`);
    console.log('[seed] done.');
    return;
  }

  const complaints = [
    // Aryabhatta
    { studentId: rahul,  hostelId: arya,  category: 'Wi-Fi',        description: 'No Wi-Fi signal in room B-204 since morning.',  status: 'Pending',     daysAgo: 1 },
    { studentId: rahul,  hostelId: arya,  category: 'Electricity',  description: 'Ceiling fan not working.',                      status: 'In Progress', remarks: 'Electrician assigned.',          daysAgo: 4 },
    { studentId: rahul,  hostelId: arya,  category: 'Furniture',    description: 'Study chair is broken.',                        status: 'Resolved',    remarks: 'Chair replaced.',                daysAgo: 12, resolvedDaysAgo: 9 },
    { studentId: ananya, hostelId: arya,  category: 'Plumbing',     description: 'Leaking tap in the washroom on A-wing.',        status: 'Pending',     daysAgo: 2 },
    { studentId: ananya, hostelId: arya,  category: 'Water Supply', description: 'No hot water in the mornings.',                 status: 'In Progress', remarks: 'Geyser under inspection.',       daysAgo: 6 },
    // Ramanujan
    { studentId: karan,  hostelId: raman, category: 'Security',     description: 'Main gate CCTV appears to be off.',             status: 'In Progress', remarks: 'Reported to security office.',   daysAgo: 3 },
    { studentId: karan,  hostelId: raman, category: 'Electricity',  description: 'Frequent power trips in C-wing.',               status: 'Resolved',    remarks: 'Faulty MCB replaced.',           daysAgo: 20, resolvedDaysAgo: 16 },
    { studentId: priya,  hostelId: raman, category: 'Wi-Fi',        description: 'Wi-Fi very slow in the evening.',               status: 'Pending',     daysAgo: 1 },
    { studentId: priya,  hostelId: raman, category: 'Cleaning',     description: 'Corridor not cleaned for two days.',            status: 'Closed',      remarks: 'Cleaning rescheduled and done.', daysAgo: 15, resolvedDaysAgo: 13 },
    // Bhaskara
    { studentId: amit,   hostelId: bhas,  category: 'Cleaning',     description: 'Washroom needs deep cleaning.',                 status: 'Pending',     daysAgo: 2 },
    { studentId: amit,   hostelId: bhas,  category: 'Plumbing',     description: 'Flush not working in D-305.',                   status: 'In Progress', remarks: 'Plumber will visit tomorrow.',   daysAgo: 5 },
    { studentId: sneha,  hostelId: bhas,  category: 'Furniture',    description: 'Cupboard door hinge is loose.',                 status: 'Resolved',    remarks: 'Hinge fixed.',                   daysAgo: 10, resolvedDaysAgo: 7 },
    { studentId: sneha,  hostelId: bhas,  category: 'Other',        description: 'Request to add a dustbin on the floor.',        status: 'Closed',      remarks: 'Dustbin provided.',              daysAgo: 18, resolvedDaysAgo: 15 },
  ];

  inTransaction(() => {
    for (const c of complaints) seedComplaint(c);
  });
  console.log(`[seed] inserted ${complaints.length} complaints across 3 hostels.`);
  console.log('[seed] done.');
}

run();
