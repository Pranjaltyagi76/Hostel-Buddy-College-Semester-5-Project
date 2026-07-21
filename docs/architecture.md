# Architecture — Hostel Buddy

How the system is structured, why the pieces are split the way they are, and how a request flows end to end.

---

## 1. Architectural Style

Hostel Buddy is a **three-tier web application** with a **layered backend**:

```
┌─────────────────────────────────────────────┐
│  PRESENTATION TIER                            │
│  Static HTML/CSS/JS pages + Chart.js          │
│  (served as static files, talk to API only)   │
└───────────────────┬───────────────────────────┘
                    │  JSON over HTTPS (JWT in header)
┌───────────────────▼───────────────────────────┐
│  APPLICATION TIER  (Node.js + Express)         │
│                                                │
│  Routes ─► Middleware ─► Controllers ─►        │
│                    Services ─► Data Access     │
└───────────────────┬───────────────────────────┘
                    │  SQL
┌───────────────────▼───────────────────────────┐
│  DATA TIER                                      │
│  SQLite file (dev)  →  Postgres (prod option)   │
│  + /uploads for complaint images                │
└─────────────────────────────────────────────────┘
```

The presentation tier is intentionally "dumb": it holds no business rules, only renders data and calls the API. **Every rule — validation, authorization, lifecycle — lives on the server.** This is what makes the client swappable (a React SPA or a mobile app could replace it without backend changes).

---

## 2. Backend Layering

Each request passes through clearly separated layers. This is the core "signal" of the design: responsibilities don't leak across boundaries.

| Layer | Responsibility | Example |
|-------|----------------|---------|
| **Routes** | Map URL + verb to a handler; declare which middleware applies. | `POST /api/complaints` → `auth`, `student-only`, `upload`, `createComplaint` |
| **Middleware** | Cross-cutting concerns: auth, role checks, file upload, error handling, validation. | `requireRole('admin')` |
| **Controllers** | Parse/validate the HTTP request, call a service, shape the HTTP response. Thin. | `complaintController.create` |
| **Services** | Business logic and rules. No knowledge of HTTP or SQL specifics. | "A student may only edit a Pending complaint." |
| **Data Access (Repositories)** | The only layer that talks SQL. Returns plain objects. | `complaintRepo.findByUser(userId)` |

**Why this matters:** to swap SQLite for Postgres you touch only the data-access layer. To add email notifications you add a call in the service layer. Controllers and routes stay stable.

---

## 3. Module Breakdown

Features are vertical slices, each independently maintainable (NFR: maintainability):

```
src/
├── config/          # env, db connection, constants (categories, statuses)
├── middleware/      # auth, roleGuard, upload, errorHandler, validate
├── modules/
│   ├── auth/        # register, login, JWT issue/verify
│   ├── users/       # profile, student list, admin account mgmt
│   ├── complaints/  # CRUD + lifecycle + search/filter
│   └── dashboard/   # aggregate statistics for student & admin
├── db/              # schema.sql, migrations, seed, connection
└── app.js           # wires routes + middleware together
```

Each module typically contains `*.routes.js`, `*.controller.js`, `*.service.js`, and `*.repo.js`.

---

## 4. Data Model

Two core tables (see [technical_design.md](technical_design.md) for exact columns and constraints).

```
┌──────────────┐         ┌────────────────────┐
│    users     │ 1     * │     complaints      │
├──────────────┤─────────├────────────────────┤
│ id (PK)      │         │ id (PK)             │
│ name         │         │ user_id (FK→users)  │
│ email (uniq) │         │ category            │
│ password_hash│         │ description         │
│ room_number  │         │ image_url           │
│ role         │         │ status              │
│ created_at   │         │ admin_remarks       │
└──────────────┘         │ created_at          │
                         │ updated_at          │
                         │ resolved_at         │
                         └────────────────────┘
```

One student has many complaints. A complaint always belongs to exactly one student. The admin is just a `users` row with `role = 'admin'`.

---

## 5. Request Flow — "Student submits a complaint"

```
Browser (Raise Complaint form)
   │  multipart POST /api/complaints  (Authorization: Bearer <JWT>)
   ▼
[auth middleware]        verify JWT → attach req.user
   ▼
[roleGuard('student')]   reject if not a student
   ▼
[upload middleware]      save optional image → req.file
   ▼
[validate middleware]    category in enum? description non-empty?
   ▼
[controller.create]      build DTO from req.body + req.file
   ▼
[service.create]         set status = Pending, timestamps
   ▼
[repo.insert]            INSERT INTO complaints ...
   ▼
201 Created  ◄── JSON complaint object ──► browser updates "My Complaints"
```

Any failure short-circuits to the **central error handler**, which returns a consistent JSON error shape (`{ error: { message, code } }`) and the right HTTP status.

---

## 6. Authentication & Authorization

- **Authentication:** On login the server verifies the bcrypt hash and issues a **JWT** signed with a server secret, containing `{ userId, role }`. The client stores it and sends it in the `Authorization: Bearer` header.
- **Authorization:** Two guards — `requireAuth` (valid token) and `requireRole(role)` (correct role). Ownership checks (a student touching only their own complaint) live in the service layer, not just the route, so they can't be bypassed by a different entry point.

---

## 7. Scalability Path

The v1 runs as a single Node process with SQLite — perfect for a class demo. The architecture makes the growth path explicit:

| Concern | v1 (demo) | Production path |
|---------|-----------|-----------------|
| Database | SQLite file | Managed Postgres (swap data-access layer only) |
| Image storage | Local `/uploads` | S3 / object store (swap upload middleware) |
| Sessions | Stateless JWT | Already horizontally scalable — no server affinity |
| App instances | 1 | N behind a load balancer (stateless app enables this) |
| Notifications | none | Service-layer hook → email/push worker |

Because the app tier is **stateless** (JWT, no in-memory session), adding instances behind a load balancer needs no code change.

---

## 8. Cross-Cutting Concerns

- **Validation:** centralized middleware + service-level rules; never trust the client.
- **Error handling:** one error handler, one error shape, correct status codes.
- **Configuration:** all secrets/URLs via environment variables (`.env`), never hardcoded.
- **Logging:** request logging in dev; structured logs are a production add-on.

---

## 9. Technology Choices & Rationale

| Choice | Why | Trade-off accepted |
|--------|-----|--------------------|
| **Node + Express** | Minimal, ubiquitous, fast to build a clean layered API. | Not opinionated — structure is on us (hence the module layout). |
| **SQLite (dev)** | Zero-config, file-based, perfect for a demo; real SQL so the mental model transfers to Postgres. | Not ideal for high write concurrency — acceptable for v1. |
| **JWT auth** | Stateless, scales horizontally, simple. | Token revocation is harder — acceptable for v1. |
| **Vanilla JS + Chart.js frontend** | No build step, easy to read, deploys anywhere. | Less ergonomic than React at scale — fine for this scope. |
| **Multer local uploads** | Simplest working image upload. | Not durable across instances — documented swap to object store. |
