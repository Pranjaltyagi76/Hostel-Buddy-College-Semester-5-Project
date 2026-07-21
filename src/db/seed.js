'use strict';

// Demo seed script:  npm run seed
// Populates the database with the admin, a handful of sample students, and a
// spread of complaints across categories and statuses so the dashboards and
// admin views have realistic data to show. Safe to re-run: students are
// created only if missing, and complaints are seeded only when the table is
// empty (so re-running never duplicates data).
const bcrypt = require('bcryptjs');
const { initSchema, db } = require('./index');
const { seedAdmin } = require('./seedAdmin');
const usersRepo = require('../modules/users/users.repo');

const SAMPLE_PASSWORD = 'student123';

function ensureStudent(name, email, room) {
  const existing = usersRepo.findByEmail(email);
  if (existing) return existing;
  const passwordHash = bcrypt.hashSync(SAMPLE_PASSWORD, 10);
  return usersRepo.createUser({ name, email, passwordHash, roomNumber: room, role: 'student' });
}

// Insert a complaint with an explicit status/date (bypasses the service, which
// intentionally forces new complaints to Pending — seeding needs variety).
function seedComplaint({ userId, category, description, status, remarks = null, daysAgo = 0, resolvedDaysAgo = null }) {
  // daysAgo / resolvedDaysAgo are integers controlled by this script, so it is
  // safe to inline them into the datetime() modifiers.
  const resolvedExpr = resolvedDaysAgo != null ? `datetime('now', '-${resolvedDaysAgo} days')` : 'NULL';
  db.prepare(
    `INSERT INTO complaints
       (user_id, category, description, status, admin_remarks, created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-${daysAgo} days'), datetime('now', '-${daysAgo} days'), ${resolvedExpr})`
  ).run(userId, category, description, status, remarks);
}

function run() {
  initSchema();
  seedAdmin();

  const [rahul, ananya, karan, priya, amit] = [
    ['Rahul Sharma', 'rahul@hostel.test', 'B-204'],
    ['Ananya Verma', 'ananya@hostel.test', 'A-112'],
    ['Karan Nair', 'karan@hostel.test', 'C-007'],
    ['Priya Singh', 'priya@hostel.test', 'B-210'],
    ['Amit Kumar', 'amit@hostel.test', 'D-305'],
  ].map(([name, email, room]) => ensureStudent(name, email, room));

  console.log('[seed] students ready (password for all sample students: ' + SAMPLE_PASSWORD + ')');

  const existing = db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n;
  if (existing > 0) {
    console.log(`[seed] complaints already present (${existing}) — skipping complaint seed.`);
    console.log('[seed] done.');
    return;
  }

  const complaints = [
    { userId: rahul.id,  category: 'Wi-Fi',        description: 'No Wi-Fi signal in room B-204 since morning.',      status: 'Pending',     daysAgo: 1 },
    { userId: rahul.id,  category: 'Electricity',  description: 'Ceiling fan not working.',                          status: 'In Progress', remarks: 'Electrician assigned.',            daysAgo: 4 },
    { userId: rahul.id,  category: 'Furniture',    description: 'Study chair is broken.',                            status: 'Resolved',    remarks: 'Chair replaced.',                  daysAgo: 12, resolvedDaysAgo: 9 },
    { userId: ananya.id, category: 'Plumbing',     description: 'Leaking tap in the washroom on A-wing.',            status: 'Pending',     daysAgo: 2 },
    { userId: ananya.id, category: 'Water Supply', description: 'No hot water in the mornings.',                     status: 'In Progress', remarks: 'Geyser under inspection.',         daysAgo: 6 },
    { userId: ananya.id, category: 'Cleaning',     description: 'Corridor not cleaned for two days.',               status: 'Closed',      remarks: 'Cleaning rescheduled and done.',   daysAgo: 15, resolvedDaysAgo: 13 },
    { userId: karan.id,  category: 'Security',     description: 'Main gate CCTV appears to be off.',                 status: 'In Progress', remarks: 'Reported to security office.',     daysAgo: 3 },
    { userId: karan.id,  category: 'Electricity',  description: 'Frequent power trips in C-wing.',                   status: 'Resolved',    remarks: 'Faulty MCB replaced.',             daysAgo: 20, resolvedDaysAgo: 16 },
    { userId: priya.id,  category: 'Wi-Fi',        description: 'Wi-Fi very slow in the evening.',                   status: 'Pending',     daysAgo: 1 },
    { userId: priya.id,  category: 'Furniture',    description: 'Cupboard door hinge is loose.',                     status: 'Resolved',    remarks: 'Hinge fixed.',                     daysAgo: 10, resolvedDaysAgo: 7 },
    { userId: amit.id,   category: 'Cleaning',     description: 'Washroom needs deep cleaning.',                     status: 'Pending',     daysAgo: 2 },
    { userId: amit.id,   category: 'Plumbing',     description: 'Flush not working in D-305.',                       status: 'In Progress', remarks: 'Plumber will visit tomorrow.',     daysAgo: 5 },
    { userId: amit.id,   category: 'Other',        description: 'Request to add a dustbin on the floor.',            status: 'Closed',      remarks: 'Dustbin provided.',                daysAgo: 18, resolvedDaysAgo: 15 },
  ];

  for (const c of complaints) seedComplaint(c);
  console.log(`[seed] inserted ${complaints.length} sample complaints.`);
  console.log('[seed] done.');
}

run();
