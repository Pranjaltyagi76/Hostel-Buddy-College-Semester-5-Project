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
**Fix:** Made every suite **self-contained** — each registers its own student(s) and creates its own complaints, and asserts invariants and deltas (e.g. "total increased by exactly 3", "byStatus sums to totalComplaints") rather than absolute seed counts. Now the full suite passes in any order (`npm test`).
**Lesson:** An integration test must control its own preconditions; a test that only passes first is not really passing.

### B7 — A strict Content-Security-Policy blocks inline scripts
**Problem:** Adding `helmet` with a `script-src 'self'` policy would block the one inline `<script>` on the landing page (the "redirect if already logged in" check), breaking it.
**Root cause:** CSP treats inline scripts as unsafe by default; even a tiny inline script forces you to weaken the policy with `'unsafe-inline'`.
**Fix:** Moved the inline script into an external file (`js/index.js`) so the policy can stay `script-src 'self'`. Inline *styles* are still allowed (`style-src 'unsafe-inline'`) because several pages use `<style>` blocks — a documented, lower-risk relaxation.
**Lesson:** Keep scripts in external files from the start; it costs nothing and lets you ship a strict CSP.

---

## Audit pass — bugs found by attacking the running application

After Phase 6 the whole application was audited against a running server: all
suites, then manual probing of the API with malformed and hostile input, then a
browser walkthrough of every page at desktop and mobile widths. 237 probe
requests produced zero 5xx responses, and SQL injection, XSS, JWT forgery, mass
assignment, ownership isolation and path traversal all held. The fifteen entries
below are what *did* break. Every one is now pinned by a check in
`tests/regression.test.js`.

### B8 — A JSON object was stored as the literal text "[object Object]"
**Problem:** `POST /api/auth/register` with `{"name": {"a": 1}}` returned 201 and created an account named `[object Object]`. The same held for a complaint's description, a profile's room number, and an admin's remarks — the junk was visible on the admin's complaint table.
**Root cause:** Every validator coerced first and checked second: `if (!name || !String(name).trim())`. `String({})` is a non-empty string, so an object passed validation and was written to the database. The helper that would have caught it, `isNonEmptyString`, existed in `utils/validators.js` and was **exported but never called anywhere in the codebase**.
**Fix:** Rewrote `validators.js` around explicit type predicates (`isString`, `isNonEmptyString`) and used them at every entry point in `auth.service`, `users.service` and `complaints.service`. A value of the wrong type is now a 400, never something to coerce.
**Lesson:** Dead code in a validation module is a warning sign, not clutter. Check the type *before* you touch the value — coercion turns a bug you would have caught into data you have to clean up.

### B9 — Any status could jump to any other, leaving complaints "Pending" with a resolution date
**Problem:** FR-14 specifies Pending → In Progress → Resolved → Closed, but `updateStatus` only validated that the target was one of the four names. Closed could go back to Pending. Because `resolved_at` is deliberately never cleared, rolling a Resolved complaint backwards produced a row that was **Pending with a resolution date** — and a student could then edit a complaint that had already been resolved.
**Root cause:** The lifecycle was documented and drawn in the README, but only the *vocabulary* was enforced, not the *ordering*. Validating set membership felt like validating the rule.
**Fix:** Added a transition guard in `complaints.service`: a complaint's index in `STATUSES` may stay the same (a remarks-only edit) or increase, never decrease; a backwards move returns `409 INVALID_TRANSITION`. `resolved_at` is now set the first time a complaint reaches Resolved *or beyond*, so a direct Pending → Closed no longer leaves it null. The admin's dropdown offers only statuses the server will accept, so the rule is visible rather than a surprise error.
**Lesson:** A state machine drawn in a diagram is not a state machine in the code. If the order matters, something has to compare positions.

### B10 — The test suite wrote into the demo database and needed a manually started server
**Problem:** `npm test` assumed a server was already running and died with a raw `ECONNREFUSED` stack trace when it wasn't. Worse, the suites hit the development server, so they used `data/hostel.db` and never cleaned up — after a few runs the admin screen was full of "Test Student", "Dash Tester" and the `[object Object]` account from B8. One test also opened `data/hostel.db` **directly by hardcoded path** to flip a complaint's status, reaching around the API entirely.
**Root cause:** The tests were written as "point them at whatever is on :4000". That is convenient exactly once and coupling forever: to a port, to a database file, and to whatever state previous runs left behind.
**Fix:** Added `tests/run.js`. It starts the server on port 4010 with `DB_PATH=data/test.db` and `UPLOAD_DIR=uploads/.test`, polls `/api/health` until it answers, runs every suite, then shuts down and deletes both. Suites take their base URL from `HB_TEST_BASE`, so they still run standalone. The test that poked the database now advances the complaint through the admin endpoint instead.
**Lesson:** A test that needs a human to set something up first will eventually be run without it. And an integration test that reaches around the API is testing the database, not the application.

### B11 — FR-17 was implemented on the server and unreachable in the product
**Problem:** `GET /api/users` worked correctly, was admin-gated and returned students without password hashes — but no page ever called it and the admin navigation had no link. The requirement was complete on one side of the wire and invisible on the other.
**Root cause:** The endpoint was built during the API phase and the UI phase never circled back. Nothing failed, because nothing tested the requirement end to end.
**Fix:** Added `admin-students.html` / `js/admin-students.js` and a Students link in the admin nav, with client-side filtering over name, email and room.
**Lesson:** A requirement is done when a user can reach it. Track requirements through the UI, not the route table.

### B12 — Upload type checking trusted the browser's word
**Problem:** `fileFilter` read `file.mimetype`, which is whatever the client writes in the multipart header. A text file declared as `image/png` was accepted, stored with a `.png` extension, and served back as `image/png`.
**Root cause:** The declared MIME type was treated as a fact about the file rather than a claim by the client. Helmet's `nosniff` header meant this was never executable XSS, which is why it went unnoticed.
**Fix:** After Multer saves the file, `verifyUploadedImage` reads the first 12 bytes and identifies the real format from its signature (PNG's 8-byte magic, JPEG's `FF D8 FF`, `RIFF....WEBP`). Anything that isn't a genuine PNG/JPEG/WEBP — or whose bytes disagree with its declared type — is deleted and rejected.
**Lesson:** Anything the client sends is a claim. If a decision depends on what a file *is*, read the file.

### B13 — Framework error messages leaked to the client
**Problem:** A malformed JSON body returned `"Expected property name or '}' in JSON at position 1 (line 1 column 2)"`, and an unexpected upload field returned Multer's `"Unexpected field"`. Both went straight to the user.
**Root cause:** The error handler returned `err.message` for anything under 500. That is right for our own `AppError`s, which are written for users, and wrong for everything Express, body-parser or Multer throws.
**Fix:** Only an `AppError` keeps its message and code. Everything else is mapped to a written message and a stable code by status. Multer's codes are translated in `upload.js` before they ever reach the handler.
**Lesson:** "Don't leak internals" is usually applied to 500s. Every status deserves the same rule — a 400 can leak just as much.

### B14 — Percent and underscore in the admin search behaved as wildcards
**Problem:** Searching for a single `%` returned every complaint; `_` matched any single character. Correct results, wrong question.
**Root cause:** The term was wrapped in percent signs and handed to `LIKE`. Binding it as a parameter prevents injection but does nothing about LIKE's own metacharacters — a distinction that is easy to miss once you know the query is parameterised.
**Fix:** `escapeLike()` escapes the backslash, `%` and `_`, and every `LIKE` now carries an explicit `ESCAPE` clause.
**Lesson:** Parameterisation protects the *parser*, not the *pattern language*. `LIKE` has a second grammar inside the bound value.

### B15 — bcrypt silently truncated long passwords
**Problem:** A user who registered with an 80-character password could sign in with the first 72 characters followed by anything.
**Root cause:** bcrypt hashes at most 72 bytes and ignores the rest. The code enforced a minimum length and no maximum, so a longer password looked stronger while being weaker than the user believed.
**Fix:** Passwords over 72 **bytes** (not characters — multi-byte characters cost more) are rejected at registration with a clear message.
**Lesson:** Know where your crypto library stops reading. A silent limit is worse than a loud one.

### B16 — Brute-force protection was disabled in the only environment anyone runs
**Problem:** `authLimiter` was replaced by a no-op unless `NODE_ENV === 'production'`, and the app is demonstrated in `development`. The rate limiting we designed, documented and presented was never actually running.
**Root cause:** "Don't throttle local development and the tests" was reasonable; implementing it as "production only" quietly meant "never, in practice".
**Fix:** The limiter is active in development and production and disabled only under the test runner. `skipSuccessfulRequests` makes it count *failed* attempts, so a real user signing in repeatedly is never locked out while a password guesser still is; the ceiling is 20 failures in production and 100 elsewhere. `app.set('trust proxy', 1)` is set in production so a reverse proxy doesn't collapse every client into one IP.
**Lesson:** Security that only exists in an environment you never run is not security. Disable it for tests, not for yourself.

### B17 — Small correctness and polish defects
Grouped because each is self-contained and none touches business logic:

- **Page numbers past the end were echoed back.** `?page=99999` returned `page: 99999` alongside `totalPages: 4`. The repository now computes the total first and clamps the page to the last one that exists.
- **A student could replace an attached image but never remove one.** `updateComplaint` only swapped `image_url` when a new file arrived. It now accepts a `remove_image` flag, and the edit dialog shows a "Remove the current image" checkbox when there is one.
- **An unknown page returned Express's stock HTML error.** Unmatched API routes had a clean JSON 404 while a mistyped page left the product entirely. Added `public/404.html` in the app's own styling, served by a catch-all that still answers JSON to non-HTML clients.
- **The admin dialog's delayed close could dismiss the wrong complaint.** The 700 ms "show the confirmation, then close" timer was never cancelled, so opening another complaint inside that window closed the new dialog. The timer id is now kept and cleared.
- **Row action buttons sat off-screen on a phone.** At 375 px the tables scroll sideways and the actions are the last column, so View/Edit/Delete were invisible until you discovered the table scrolled. The action column is now pinned with `position: sticky`.
- **Code hygiene.** `app.js` required `config/env` a second time inline despite importing it at the top. `requestLogger` wrote a line for every request in every environment; it is now verbose in development, 4xx/5xx-only in production, and silent under the test runner.

**Lesson (for the group):** every one of these was found by *running* the application against hostile input, not by reading it. The suites were green the whole time — they tested the paths we designed, which is exactly the input an audit should not limit itself to.

---

## Environment / tooling notes

- **Windows paths & SQLite:** `DB_PATH` uses a relative path resolved from the project root so the same config works on Windows and Linux deploys.
- **`.env` not committed:** early on the admin seed silently failed because `ADMIN_PASSWORD` wasn't set; added a startup check that logs a clear warning if required env vars are missing, and shipped `.env.example`.

---

## How this document is used

Every real bug that costs more than a few minutes gets an entry. The value isn't the fix — it's the **root cause** and **lesson**, which is what prevents the same class of bug next time and shows the reasoning behind the code.
