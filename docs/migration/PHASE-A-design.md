# Phase A — Schema v2 Design Record

**Status:** Complete. Design approved and verified; no application code changed yet.
**Next:** Phase B applies this schema to the running application.

The course instructor supplied an ER model that differs substantially from the
schema Hostel Buddy v1 was built on. This document records the target design,
the decisions taken, and the evidence that the schema works.

---

## 1. Decisions taken

| # | Question | Decision | Reason |
|---|----------|----------|--------|
| 1 | Keep `category` and `admin_remarks`? | **Keep** | They implement REQ-10, REQ-24, REQ-30 and REQ-36. Dropping them would break the category filter, the admin remarks feature and the whole category-distribution chart. An ER diagram normally shows important attributes only, so their absence is not a instruction to delete them. |
| 2 | Is a Manager limited to one hostel? | **Yes** | `MANAGER.hostel_id` only has meaning if it scopes authority. A manager sees and acts on their own hostel's complaints; a super admin is unscoped. |
| 3 | Does Super Admin manage hostels? | **Yes** | The diagram shows a `manages` relationship from SUPER_ADMIN to HOSTEL. Super admin gets hostel CRUD and can create manager accounts. |
| 4 | Implement `video_url` fully? | **Yes, in Phase F** | Real video upload needs its own MIME/magic-byte checks, a much larger size cap and a player. Deferred so it cannot block the schema work. |
| 5 | Keep `room_number`? | **Keep, on STUDENT** | A complaint about a leaking tap is far less actionable without the room. Retained as an attribute of STUDENT rather than USER. |

---

## 2. Table mapping — v1 to v2

| v1 | v2 | Change |
|----|----|--------|
| `users` | `user` | Renamed. `id` → `user_id`. `room_number` moves to `student`. Role enum changes from `student\|admin` to `student\|manager\|super_admin`. |
| — | `student` | **New** subtype: `user_id` (PK/FK), `roll_no` (unique), `hostel_id` (FK), `room_number`. |
| — | `manager` | **New** subtype: `user_id` (PK/FK), `hostel_id` (FK). |
| — | `super_admin` | **New** subtype: `user_id` (PK/FK). No hostel — unscoped by design. |
| — | `hostel` | **New**: `hostel_id` (PK), `hostel_name` (unique), `location`, `capacity`. |
| `complaints` | `complaint` | Renamed. `id` → `complaint_id`, `user_id` → `student_id`, `description` → `problem_description`. **Adds** `hostel_id` and `video_url`. Keeps `category` and `admin_remarks`. |

**Net effect:** 2 tables become 6; 2 roles become 3; the system gains multi-hostel support.

---

## 3. Design notes

### DN-1 — Shared primary key for subtypes
Each subtype's primary key *is* its foreign key to `user`. One user therefore
cannot hold two identities, and no surrogate key is needed on the subtype.

### DN-2 — Discriminator consistency is enforced in the service layer
`user.role` states which subtype row should exist. SQL alone cannot guarantee
that a row with `role='student'` has a matching `student` row and no `manager`
row. Both writes therefore happen **in a single transaction** in the service
layer. This is the one integrity rule the database cannot hold for us, so it is
noted here and will be covered by tests in Phase C.

### DN-3 — Why COMPLAINT stores `hostel_id`
It could be derived by joining through `student`, so at first glance it looks
redundant. It is kept for two reasons:

1. **It is a historical fact, not a copy.** It records the hostel the complaint
   was raised *against, at the time it was raised*. If a student later changes
   hostel, past complaints must stay with the original hostel. Read that way it
   is an independent attribute and does **not** violate 3NF.
2. **It makes manager scoping cheap** — one indexed column instead of a join on
   every admin query.

### DN-4 — Only students may raise complaints
`complaint.student_id` references `student(user_id)`, not `user(user_id)`. The
database itself therefore rejects a complaint raised by a manager or a super
admin — this rule does not depend on application code being correct.

---

## 4. Data strategy

**Drop and re-seed.** The database holds only demonstration data, and the
column renames plus three new tables make an in-place migration far more work
than it is worth. Phase B will:

1. Delete `data/hostel.db`.
2. Apply `schema-v2.sql` on startup.
3. Re-seed: hostels first, then a super admin, one manager per hostel, and
   students with roll numbers linked to hostels.

No production data exists, so nothing is lost.

---

## 5. Verification performed

The schema was executed against SQLite and its constraints deliberately
attacked. All 6 tables and 6 indexes create cleanly, and every rule below was
confirmed to **block** the invalid case:

| Attempted violation | Result |
|---------------------|--------|
| Complaint raised by a manager (not a student) | Blocked |
| Invalid role value (`admin`) | Blocked |
| Duplicate `roll_no` | Blocked |
| Duplicate `email` | Blocked |
| Student assigned to a non-existent hostel | Blocked |
| Invalid complaint status | Blocked |
| Hostel capacity of zero | Blocked |

The manager hostel-scoping query — the core new authorisation rule — was run
and returned the correct rows.

> **Note on portability.** The table is named `user` to match the instructor's
> diagram. SQLite accepts this unquoted. `USER` is a reserved word in
> PostgreSQL, so a future migration there would need it quoted or renamed. This
> is recorded rather than worked around, because matching the supplied diagram
> takes priority.

---

## 6. Deliverables

| File | Purpose |
|------|---------|
| `docs/migration/schema-v2.sql` | The target schema, verified but not yet applied |
| `docs/migration/er-schema-v2.png` | ER diagram of the target schema, for comparison with the supplied model |
| `docs/migration/PHASE-A-design.md` | This record |

---

## 7. What Phase B will do

1. Replace `src/db/schema.sql` with the verified v2 schema.
2. Rewrite `src/db/seed.js` — hostels, then users of all three types.
3. Rename `src/db/seedAdmin.js` to seed a **super admin**.
4. Extend `ROLES` in `src/config/constants.js` to three values.

**Phase B is finished when** the server boots, all six tables exist, and the
seed loads hostels plus all three user types. No feature will work correctly
until Phase C rebuilds authentication on top of the new role model — that is
expected, and is why B and C should be done back to back.
