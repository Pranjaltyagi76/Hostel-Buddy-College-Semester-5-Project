# Requirements — Hostel Buddy

*Smart Hostel Complaint Management System*

This document captures **what** the system must do and **why**, before any code is written. It is the contract the rest of the project is measured against.

---

## 1. Problem Statement

Hostels traditionally track maintenance complaints in a physical register at the warden's office. This is slow, easy to lose, impossible to search, and gives students no visibility into whether their issue is being handled. **Hostel Buddy** replaces that register with a small web application where students raise complaints online and an administrator resolves them from a dashboard.

The goal is a **model working version** — realistic enough to demonstrate the full workflow and deploy for classmates, without the scope of a production hostel-management suite.

---

## 2. Scope

### In scope (v1)
- Student self-registration and login
- Complaint submission with category, description, and optional image
- Complaint lifecycle tracking (Pending → In Progress → Resolved → Closed)
- Student dashboard with personal complaint statistics
- Admin dashboard with global statistics and category distribution
- Admin search, filter, and status/remarks updates
- Role-based access control (Student vs Admin)

### Out of scope (v1 — see [Future Enhancements](#8-future-enhancements))
- Email / push notifications
- A separate maintenance-staff role
- Multi-hostel / multi-block segmentation
- Complaint ratings, QR codes, AI categorization, native mobile app

---

## 3. User Roles

| Role | Description |
|------|-------------|
| **Student** | Registers, logs in, raises and tracks complaints. Can only see and manage their own complaints. |
| **Administrator** | Logs in with a seeded account. Sees all complaints, updates status, adds remarks, views analytics, manages student accounts. |

There is deliberately **no maintenance-staff role**. The admin simply advances complaint status. This preserves the full workflow while cutting implementation complexity.

---

## 4. Functional Requirements

Each requirement has a stable ID (`FR-x`) so design and tests can reference it.

### Authentication & Accounts
- **FR-1** A visitor can register as a student with name, email, password, and room number.
- **FR-2** Emails must be unique; duplicate registration is rejected with a clear message.
- **FR-3** Passwords are never stored in plaintext (hashed with bcrypt).
- **FR-4** Students and the admin log in and receive a session token (JWT).
- **FR-5** A student can view and update their own profile (name, room number).

### Complaints — Student
- **FR-6** A logged-in student can submit a complaint: category (from a fixed list), free-text description, optional image.
- **FR-7** New complaints are created with status **Pending**.
- **FR-8** A student can list all of their own complaints ("My Complaints") with current status, dates, and admin remarks.
- **FR-9** A student can **edit or delete** a complaint **only while it is still Pending**.
- **FR-10** A student can see their own dashboard totals: Total, Pending, In Progress, Resolved, Closed.

### Complaints — Admin
- **FR-11** The admin can view **all** complaints across all students.
- **FR-12** The admin can search/filter by Complaint ID, Student Name, Room Number, Category, and Status.
- **FR-13** The admin can open a complaint, read details, add remarks, and change its status.
- **FR-14** Status changes follow the lifecycle Pending → In Progress → Resolved → Closed.
- **FR-15** When a complaint reaches **Resolved**, a resolved-date is recorded.
- **FR-16** The admin dashboard shows: total students, total complaints, counts per status, category distribution, and recent complaints.
- **FR-17** The admin can view the list of student accounts.

### Access Control
- **FR-18** Student-only endpoints reject admin-less/anonymous requests.
- **FR-19** Admin-only endpoints reject non-admin tokens.
- **FR-20** A student can never read or modify another student's complaint.

---

## 5. Complaint Categories

`Electricity` · `Plumbing` · `Water Supply` · `Wi-Fi` · `Cleaning` · `Furniture` · `Security` · `Other`

These are a closed enum validated on the server. Adding a category is a one-line change (see [architecture.md](architecture.md)).

---

## 6. Complaint Status Lifecycle

```
Pending  →  In Progress  →  Resolved  →  Closed
```

- The lifecycle is **forward-only** in the normal flow; the admin drives every transition.
- The student is read-only on status.
- Timestamps captured: `created_at` (submission), `updated_at` (any change), `resolved_at` (first time it hits Resolved).

---

## 7. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | Dashboard loads in 2–3 s; complaint submission completes within ~2 s on a typical connection. |
| **Security** | bcrypt password hashing, JWT auth, role-based authorization, server-side input validation, no secrets in the client. |
| **Reliability** | Complaint data persists durably; no data loss during normal operation. |
| **Scalability** | Layered architecture supports thousands of students and complaints; DB is swappable (SQLite → Postgres) without touching business logic. |
| **Maintainability** | Auth, complaints, dashboard, and users are independent modules. |
| **Usability** | Responsive UI usable on desktop and mobile browsers. |

---

## 8. Future Enhancements

Explicitly deferred, but the architecture leaves room for them:
Email notifications · Push notifications · Maintenance-staff accounts · Complaint ratings · QR-code room identification · Native mobile app · AI-based categorization · Multi-hostel support.

---

## 9. Assumptions & Constraints

- A single hostel / single admin account for v1.
- Image uploads are small (a few MB) and stored on the server filesystem; a cloud object store would replace this in production.
- The demo runs on a single backend instance; horizontal scaling is a design consideration, not a v1 deliverable.

---

## 10. Acceptance Criteria (Definition of Done)

The v1 is "done" when a fresh user can, against a deployed URL:
1. Register, log in, and land on their dashboard.
2. Raise a complaint with an image and see it as **Pending**.
3. Edit it while Pending, then see edits reflected.
4. Have the admin move it through the full lifecycle and add remarks.
5. See the updated status, remarks, and resolved date as the student.
6. See dashboard statistics update on both sides.
