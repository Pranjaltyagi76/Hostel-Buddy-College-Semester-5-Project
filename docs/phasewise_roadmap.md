# Phase-wise Roadmap — Hostel Buddy

How the build is sequenced. Each phase produces something demonstrable, so progress is always visible and the project is never in a broken half-state.

---

## Guiding principle

**Vertical slices over horizontal layers.** Rather than building all data access, then all services, then all UI, each phase delivers a working thread from database to screen. This keeps the app runnable at every checkpoint and surfaces integration problems early.

---

## Phase 0 — Project Foundation
**Goal:** an empty app that boots.

- Initialize Node project, install dependencies.
- Folder skeleton per [architecture.md](architecture.md) §3.
- Express app with health check `GET /api/health`.
- Config loader (`.env`), central error handler, request logger.
- SQLite connection + `schema.sql` applied on startup.

**Done when:** `npm start` boots and `/api/health` returns `{ ok: true }`.

---

## Phase 1 — Authentication & Accounts
**Goal:** users can register and log in. (FR-1…FR-5)

- `users` table + repo.
- Register (bcrypt hash, unique email) and login (JWT issue).
- `requireAuth` + `requireRole` middleware.
- Seed admin account from env.
- `GET/PUT /users/me`, `GET /users` (admin).

**Done when:** a student can register, log in, fetch their profile; admin login works; protected routes reject bad tokens.

---

## Phase 2 — Complaint Core (Student)
**Goal:** the heart of the app — raise and track complaints. (FR-6…FR-10)

- `complaints` table + repo.
- Create complaint (Pending), list own complaints, get one.
- Edit/delete **only while Pending** (service-enforced).
- Image upload via Multer.

**Done when:** a student submits a complaint with an image, sees it in "My Complaints", edits it while Pending, and is blocked from editing once it advances.

---

## Phase 3 — Admin Complaint Management
**Goal:** the admin resolves complaints. (FR-11…FR-15)

- List all complaints with search/filter (id, name, room, category, status).
- Status transition endpoint (+ `resolved_at`, remarks).
- Ownership/role guards verified end to end.

**Done when:** the admin filters complaints, opens one, adds remarks, and drives it Pending → In Progress → Resolved → Closed; the student sees every change.

---

## Phase 4 — Dashboards & Analytics
**Goal:** at-a-glance statistics. (FR-10, FR-16)

- Student dashboard aggregation endpoint.
- Admin dashboard aggregation (totals, by-status, by-category, recent).
- Chart.js visualizations on the admin page.

**Done when:** both dashboards render live counts and the admin sees category/status charts.

---

## Phase 5 — Frontend Polish & UX
**Goal:** a clean, responsive interface. (NFR: usability)

- Consistent styling, navigation, and empty/loading/error states.
- Client-side form validation for fast feedback.
- Mobile-responsive layout pass.
- Friendly error messages surfaced from the API's error shape.

**Done when:** the full workflow is usable and presentable on desktop and mobile.

---

## Phase 6 — Hardening & Docs
**Goal:** demo-ready and portfolio-ready.

- Input-validation sweep, auth edge cases, error-path checks.
- Seed script with sample students + complaints for a good demo.
- Fill in [performance_review.md](performance_review.md) and [problems_faced_and_bugs_encountered.md](problems_faced_and_bugs_encountered.md) with real findings.
- README with setup + screenshots; record demo video.

**Done when:** the acceptance checklist ([requirements.md](requirements.md) §10) passes on a clean clone.

---

## Milestone view

| Milestone | Phases | Demonstrable outcome |
|-----------|--------|----------------------|
| **M1 — Walking skeleton** | 0–1 | App boots; auth works. |
| **M2 — Core loop** | 2–3 | Full complaint lifecycle student↔admin. |
| **M3 — Insight** | 4 | Dashboards and charts live. |
| **M4 — Ship** | 5–6 | Polished, seeded, documented, demoable. |

---

## Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Auth/role bugs let a student touch others' data | Med | Ownership check in service layer + integration test for FR-20. |
| Image upload edge cases (size/type) | Med | Multer limits + type filter; explicit error path. |
| Scope creep into future-enhancement features | High | Roadmap freezes v1 scope; extras go to [requirements.md](requirements.md) §8. |
| Dashboard queries slow as data grows | Low | Indexes on status/category/user; measured in [performance_review.md](performance_review.md). |
