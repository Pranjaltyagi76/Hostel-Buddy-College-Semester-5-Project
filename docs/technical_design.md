# Technical Design — Hostel Buddy

Implementation-level detail: database schema, API contract, auth mechanics, validation rules, and file handling. This is the document you read before writing code.

---

## 1. Tech Stack (pinned)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Web framework | Express 4 |
| Database | SQLite via Node's built-in `node:sqlite` (`DatabaseSync`); Postgres-compatible schema |
| Auth | `jsonwebtoken` (JWT) + `bcryptjs` |
| Uploads | `multer` (disk storage → `/uploads`) |
| Validation | lightweight schema checks in a `validate` middleware |
| Frontend | HTML5 + CSS3 + vanilla JS (ES modules) + Chart.js (CDN) |

---

## 2. Database Schema

```sql
-- users
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  room_number   TEXT,
  role          TEXT    NOT NULL DEFAULT 'student'
                        CHECK (role IN ('student','admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- complaints
CREATE TABLE complaints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  category      TEXT    NOT NULL
                        CHECK (category IN (
                          'Electricity','Plumbing','Water Supply','Wi-Fi',
                          'Cleaning','Furniture','Security','Other')),
  description   TEXT    NOT NULL,
  image_url     TEXT,
  status        TEXT    NOT NULL DEFAULT 'Pending'
                        CHECK (status IN (
                          'Pending','In Progress','Resolved','Closed')),
  admin_remarks TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT
);

CREATE INDEX idx_complaints_user   ON complaints(user_id);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_cat    ON complaints(category);
```

**Notes**
- `CHECK` constraints enforce the category and status enums *at the database level*, so bad data can't slip in even if a bug bypasses app validation.
- Indexes back the admin's search/filter (FR-12) and the dashboard aggregations (FR-16).
- Timestamps are ISO strings via `datetime('now')` for SQLite portability; the same columns map cleanly to Postgres `TIMESTAMPTZ`.

---

## 3. API Contract

Base path: `/api`. All bodies are JSON except complaint create/update which are `multipart/form-data` (image). All protected routes require `Authorization: Bearer <JWT>`.

### Auth
| Method | Path | Access | Body | Returns |
|--------|------|--------|------|---------|
| POST | `/auth/register` | public | `{name,email,password,room_number}` | `{token, user}` |
| POST | `/auth/login` | public | `{email,password}` | `{token, user}` |

### Users
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/users/me` | auth | Current profile |
| PUT | `/users/me` | student | Update name / room_number |
| GET | `/users` | admin | List all students (FR-17) |

### Complaints
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST | `/complaints` | student | Create (multipart, optional image) — FR-6 |
| GET | `/complaints/mine` | student | Own complaints — FR-8 |
| GET | `/complaints/:id` | owner or admin | Single complaint |
| PUT | `/complaints/:id` | student (owner, **Pending only**) | Edit — FR-9 |
| DELETE | `/complaints/:id` | student (owner, **Pending only**) | Delete — FR-9 |
| GET | `/complaints` | admin | All + search/filter — FR-11, FR-12 |
| PATCH | `/complaints/:id/status` | admin | Change status + remarks — FR-13/14/15 |

**Admin search/filter query params** (`GET /complaints`):
`?q=<id|name|room>&category=<cat>&status=<status>&page=1&limit=20`

### Dashboard
| Method | Path | Access | Returns |
|--------|------|--------|---------|
| GET | `/dashboard/student` | student | `{total,pending,inProgress,resolved,closed}` |
| GET | `/dashboard/admin` | admin | `{totalStudents,totalComplaints,byStatus,byCategory,recent[]}` |

### Standard error shape
```json
{ "error": { "message": "Human readable", "code": "VALIDATION_ERROR" } }
```
Status codes: `400` validation, `401` no/invalid token, `403` wrong role / not owner, `404` not found, `409` duplicate email, `500` unexpected.

---

## 4. Authentication Mechanics

**Registration**
1. Validate input; ensure email unique (else `409`).
2. `password_hash = bcrypt.hash(password, 10)`.
3. Insert user with `role='student'`.
4. Issue JWT, return `{token, user}` (never the hash).

**Login**
1. Look up by email.
2. `bcrypt.compare(password, password_hash)`; fail → `401` (same message for "no such email" and "wrong password" to avoid user enumeration).
3. Issue JWT.

**JWT**
- Payload: `{ userId, role, iat, exp }`, `exp` = 24h.
- Signed with `process.env.JWT_SECRET` (HS256).
- `requireAuth` middleware verifies and attaches `req.user = { userId, role }`.

**Admin account**
- Seeded once at startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars (idempotent — created only if absent). There is no admin self-registration endpoint.

---

## 5. Business Rules (service layer)

- **Create complaint:** force `status='Pending'`, set `created_at=updated_at=now`, ignore any client-supplied status.
- **Edit/Delete (student):** load complaint; assert `complaint.user_id === req.user.userId` **and** `status === 'Pending'`, else `403`. This is checked in the service, not just the route (defense in depth).
- **Status change (admin):** set `updated_at=now`; if new status is `Resolved` and `resolved_at` is null, set `resolved_at=now`. Remarks are optional but recommended.
- **Ownership on read:** `GET /complaints/:id` allowed if requester is the owner *or* an admin.

---

## 6. Validation Rules

| Field | Rule |
|-------|------|
| name | non-empty, ≤ 100 chars |
| email | valid format, unique |
| password | ≥ 6 chars |
| room_number | ≤ 20 chars |
| category | must be in the category enum |
| description | non-empty, ≤ 1000 chars |
| image | optional; `image/png\|jpeg\|webp`; ≤ 5 MB |
| status (admin) | must be in the status enum |

Validation runs server-side in middleware; the client also validates for UX but is never trusted.

---

## 7. File Upload Handling

- Multer disk storage → `/uploads`, filename = `<timestamp>-<random>.<ext>`.
- Accept `png/jpeg/webp` only; reject others with `400`.
- Max size 5 MB (Multer `limits`).
- Stored path exposed as `image_url = /uploads/<filename>`; served as static files.
- Production note: swap the storage engine for S3; the rest of the pipeline is unchanged (see [architecture.md](architecture.md) §7).

---

## 8. Frontend Structure

```
public/
├── index.html          # landing / home
├── login.html          # login (student + admin)
├── register.html       # student registration
├── dashboard.html      # student dashboard (stats)
├── raise.html          # raise complaint form
├── my-complaints.html  # student complaint list + edit/delete
├── profile.html        # student profile
├── admin.html          # admin dashboard (stats + charts + recent)
├── admin-complaints.html # all complaints + search/filter + status update
├── css/styles.css
└── js/
    ├── api.js          # fetch wrapper, attaches JWT, handles errors
    ├── auth.js         # login/register/logout, token storage
    └── <page>.js       # per-page logic
```

- Token stored in `localStorage`; `api.js` injects it and redirects to login on `401`.
- Charts (category distribution, status counts) rendered with Chart.js on the admin dashboard.
- Responsive layout via CSS fl[ex]/grid; usable on mobile (NFR: usability).

---

## 9. Configuration (`.env`)

```
PORT=4000
JWT_SECRET=change-me-in-prod
ADMIN_EMAIL=admin@hostel.test
ADMIN_PASSWORD=admin123
DB_PATH=./data/hostel.db
UPLOAD_DIR=./uploads
```

`.env` is git-ignored; a `.env.example` ships with placeholders.

---

## 10. Testing Strategy (lightweight)

- **Unit:** service-layer rules (edit-only-when-pending, resolved_at logic).
- **Integration:** key API flows (register → login → create → admin status change) via a test script hitting the running server.
- **Manual:** the acceptance checklist in [requirements.md](requirements.md) §10.
