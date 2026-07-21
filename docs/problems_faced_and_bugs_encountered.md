# Problems Faced & Bugs Encountered — Hostel Buddy

An honest engineering log: the non-obvious problems, the bugs, what caused them, and how they were resolved. Entries are added as they happen during the build. Each entry follows the same shape so the *reasoning* is visible, not just the fix.

> Template:
> **Problem** — what went wrong / what was hard.
> **Root cause** — why it happened.
> **Fix** — what was changed.
> **Lesson** — what to carry forward.

---

## Design & Architecture decisions

### D1 — Should "edit only when Pending" live in the route or the service?
**Problem:** The rule that a student can only edit/delete a Pending complaint (FR-9) could be enforced with a quick check in the route handler.
**Decision:** Enforce it in the **service layer** instead.
**Reasoning:** A route-level check protects only that one route. If a second entry point ever calls the same operation (a bulk action, an admin tool, a test helper), a route-only guard is silently bypassed. Putting the invariant in the service means the rule holds no matter who calls it.
**Lesson:** Invariants belong with the business logic, not the transport layer.

### D2 — JWT vs server-side sessions
**Problem:** Needed authentication that also supports the "scales to thousands of users / multiple instances" NFR.
**Decision:** Stateless JWT.
**Trade-off:** Token revocation before expiry is harder (no server session to delete). Accepted for v1 with a short 24 h expiry; a token blocklist is the production answer.
**Lesson:** Pick the mechanism that matches the *stated* scaling requirement, and write down the trade-off you're accepting.

### D3 — Enum enforcement: app-only or database too?
**Problem:** Categories and statuses are fixed sets. App-level validation seemed enough.
**Decision:** Enforce in **both** — validation middleware *and* SQL `CHECK` constraints.
**Reasoning:** App validation gives friendly errors; the DB constraint is the backstop that keeps data clean even if a bug or a future script bypasses the app.
**Lesson:** Defense in depth for data integrity is cheap and worth it.

### D4 — Should complaint images be access-controlled?
**Problem:** Uploaded complaint images are served as static files from `/uploads/<file>`. That endpoint is **not** behind the owner/admin authorization check that guards the complaint record itself, so anyone holding the URL can view the image.
**Decision (v1):** Accept it for the project scope, and document it here and in `app.js`.
**Reasoning:** Filenames are `Date.now()`-plus-random-hex, so they are effectively unguessable, and the URLs are only ever surfaced inside access-controlled complaint views. Fully gating images would mean streaming every image through an authenticated Express route (or issuing signed object-storage URLs), which adds real complexity for little benefit at this scale.
**Production path:** Serve images through an authorized route that re-checks ownership/admin, or move to object storage with short-lived signed URLs.
**Lesson:** An unauthenticated static path is a conscious trade-off, not an oversight — write it down so a reviewer sees it was a decision.

### D5 — Node's built-in SQLite instead of better-sqlite3
**Problem:** The technical design named `better-sqlite3`, but installing it triggers a native C++ build (node-gyp) that fails on a machine without Visual Studio / build tools.
**Decision:** Use Node's built-in `node:sqlite` (`DatabaseSync`) instead — same synchronous, prepared-statement API, zero native compilation.
**Reasoning:** Any teammate can `git clone` and `npm start` with no compiler toolchain, which matters for a group project graded on multiple machines. The SQL and schema are unchanged.
**Trade-off:** `node:sqlite` is still marked experimental (emits a warning, silenced via `--disable-warning=ExperimentalWarning` in the npm scripts). The data-access layer is isolated, so swapping back to better-sqlite3 or moving to Postgres later touches only the repo/connection modules.
**Lesson:** Match the dependency to the environment the team actually runs in.

---

## Bugs & problems log

*(Real entries are appended here during Phases 0–6. Representative examples of the kinds of issues anticipated and how they're handled:)*

### B1 — Multipart body + JSON validation collide
**Problem:** The complaint-create route uses `multipart/form-data` (for the image), but the JSON body-parser/validator expects `application/json`, so `req.body` came back empty and validation failed on every submit.
**Root cause:** Multer must run **before** the fields are readable; the generic JSON validator was ordered ahead of it and saw nothing.
**Fix:** Order middleware as `upload → validate → controller`; validate reads the text fields Multer populated on `req.body` and the file on `req.file`.
**Lesson:** Middleware order is part of the contract, not an implementation detail. Documented the order in [architecture.md](architecture.md) §5.

### B2 — Login leaks which emails exist
**Problem:** Returning "no such user" vs "wrong password" told an attacker which emails are registered (user enumeration).
**Root cause:** Two different error messages for the two failure modes.
**Fix:** Return the same generic `401 Invalid credentials` for both.
**Lesson:** Security errors should be deliberately vague; usability errors specific.

### B3 — `resolved_at` overwritten on every later update
**Problem:** Setting `resolved_at = now` whenever status was Resolved meant re-saving a Resolved complaint (e.g. editing remarks) kept bumping the resolve time; and moving Resolved → Closed shouldn't reset it.
**Root cause:** Unconditional assignment instead of "set once".
**Fix:** Only set `resolved_at` if it is currently null and the new status is Resolved.
**Lesson:** "First time X happens" is a distinct rule from "whenever X is true".

### B4 — Client trusts its own `status` field
**Problem:** The create form could, in theory, POST `status: 'Resolved'` and skip the workflow.
**Root cause:** Accepting a client-supplied status on create.
**Fix:** The service **ignores** any client status on create and forces `Pending`. Status only changes via the admin-only PATCH endpoint.
**Lesson:** Never let the client set fields that the workflow owns.

### B5 — CORS / token header on the static frontend
**Problem:** Frontend fetches failed until the `Authorization` header and JSON content type were consistently attached, and 401s left the user on a blank page.
**Root cause:** Ad-hoc `fetch` calls scattered across pages.
**Fix:** A single `api.js` wrapper injects the token, sets headers, and redirects to login on 401. All pages go through it.
**Lesson:** Centralize the network boundary; don't repeat cross-cutting logic per page.

### B6 — Integration tests silently depended on pristine seed data
**Problem:** The admin and dashboard test suites passed on their own but failed when run *after* other suites — e.g. `admin.test` picked "any Pending complaint," then tried to log in as its owner assuming the seeded password, which broke once another suite had injected complaints from students with different passwords. The dashboard suite asserted absolute counts (13 complaints) that other suites had since changed.
**Root cause:** Tests shared one database and made assumptions about global state instead of owning their data. Order-dependence hid until suites ran back to back.
**Fix:** Made every suite **self-contained** — each registers its own student(s) and creates its own complaints, and asserts invariants and deltas (e.g. "total increased by exactly 3", "byStatus sums to totalComplaints") rather than absolute seed counts. Now the full suite passes in any order (`npm test`, 103 checks).
**Lesson:** An integration test must control its own preconditions; a test that only passes first is not really passing.

### B7 — A strict Content-Security-Policy blocks inline scripts
**Problem:** Adding `helmet` with a `script-src 'self'` policy would block the one inline `<script>` on the landing page (the "redirect if already logged in" check), breaking it.
**Root cause:** CSP treats inline scripts as unsafe by default; even a tiny inline script forces you to weaken the policy with `'unsafe-inline'`.
**Fix:** Moved the inline script into an external file (`js/index.js`) so the policy can stay `script-src 'self'`. Inline *styles* are still allowed (`style-src 'unsafe-inline'`) because several pages use `<style>` blocks — a documented, lower-risk relaxation.
**Lesson:** Keep scripts in external files from the start; it costs nothing and lets you ship a strict CSP.

---

## Environment / tooling notes

- **Windows paths & SQLite:** `DB_PATH` uses a relative path resolved from the project root so the same config works on Windows and Linux deploys.
- **`.env` not committed:** early on the admin seed silently failed because `ADMIN_PASSWORD` wasn't set; added a startup check that logs a clear warning if required env vars are missing, and shipped `.env.example`.

---

## How this document is used

Every real bug that costs more than a few minutes gets an entry. The value isn't the fix — it's the **root cause** and **lesson**, which is what prevents the same class of bug next time and shows the reasoning behind the code.
