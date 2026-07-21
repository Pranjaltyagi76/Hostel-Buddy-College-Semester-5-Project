# 🏠 Hostel Buddy

**A Smart Hostel Complaint Management System** — students raise and track maintenance complaints online; administrators manage and resolve them from a dashboard. It replaces the paper complaint register with a searchable, trackable, statistics-driven web app.

> Built as a **model working version**: realistic end-to-end functionality and a clean layered architecture, without the scope of a full production system.

---

## ✨ Features

**Students**
- Register, log in, manage a profile
- Raise a complaint — pick a category, describe the issue, optionally attach a photo
- Track status in real time: **Pending → In Progress → Resolved → Closed**
- View admin remarks and resolution date
- Edit or delete a complaint while it's still Pending
- Personal dashboard with complaint statistics

**Administrator**
- Single dashboard over **all** complaints
- Search & filter by ID, student name, room number, category, or status
- Advance status and add remarks
- Analytics: totals, status breakdown, and category distribution charts
- View registered students

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 · CSS3 · vanilla JS · Chart.js |
| Backend | Node.js · Express (layered: routes → controllers → services → repositories) |
| Database | SQLite (dev) — Postgres-compatible schema |
| Auth | JWT + bcrypt password hashing, role-based access control |
| Uploads | Multer (local `/uploads`, swappable for object storage) |

Why these choices and their trade-offs: **[docs/architecture.md](docs/architecture.md) §9**.

---

## 🏗️ Architecture at a glance

```
Browser (static pages)  ──JSON/JWT──►  Express API  ──SQL──►  SQLite
  presentation tier                    application tier         data tier
                                   routes → middleware →
                                   controllers → services → repositories
```

The frontend holds no business rules — every rule (validation, authorization, complaint lifecycle) lives on the server. The data-access layer is the only place that touches SQL, so the database can be swapped without changing business logic. Full write-up: **[docs/architecture.md](docs/architecture.md)**.

---

## 📚 Documentation

This project is documented the way real engineering work is — decisions before code, and an honest record of what happened.

| Document | What it shows |
|----------|---------------|
| [requirements.md](docs/requirements.md) | Gathering & defining requirements (FRs, NFRs, acceptance criteria) |
| [architecture.md](docs/architecture.md) | System design before coding (tiers, layers, request flow) |
| [technical_design.md](docs/technical_design.md) | Implementation detail (schema, API contract, auth mechanics) |
| [phasewise_roadmap.md](docs/phasewise_roadmap.md) | Planning & sequencing complex work |
| [performance_review.md](docs/performance_review.md) | Optimization & trade-off analysis |
| [problems_faced_and_bugs_encountered.md](docs/problems_faced_and_bugs_encountered.md) | Debugging, decisions, and lessons learned |

---

## 🚀 Getting Started

> Prerequisites: Node.js 18+

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env      # then edit values (JWT secret, admin credentials)

# 3. Start the server
npm start

# App: http://localhost:4000
```

The admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` on first run. Students self-register from the app.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 4000) |
| `JWT_SECRET` | Secret for signing auth tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded administrator login |
| `DB_PATH` | SQLite database file location |
| `UPLOAD_DIR` | Where complaint images are stored |

---

## 🗺️ Complaint Lifecycle

```
Student submits          Admin works it                Done
    │                        │                          │
 Pending  ──────►  In Progress  ──────►  Resolved  ──────►  Closed
                                         (resolved_at set)
```

The student is read-only on status; the admin drives every transition.

---

## 📁 Project Structure

```
Hostel Buddy/
├── README.md
├── docs/                 # requirements, architecture, design, roadmap, reviews
├── src/
│   ├── config/           # env, db connection, constants
│   ├── middleware/       # auth, roleGuard, upload, validate, errorHandler
│   ├── modules/          # auth · users · complaints · dashboard
│   ├── db/               # schema.sql, seed
│   └── app.js
├── public/               # static frontend pages + css/js
└── uploads/              # complaint images (git-ignored)
```

---

## 🎥 Demo

*A short walkthrough video demonstrating the full student → admin workflow will be linked here.*

---

## 🔭 Roadmap / Future Enhancements

Email & push notifications · maintenance-staff role · complaint ratings · QR-code room identification · native mobile app · AI-based categorization · multi-hostel support. Scope is deliberately frozen for v1 — see [requirements.md](docs/requirements.md) §8.
