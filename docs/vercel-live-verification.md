# Vercel + Turso live acceptance evidence

Date: 4 October 2026. Application: Hostel Buddy, Group 19.
Owner: Pranjal Tyagi (2024BCD0053).

## Deployment and database

| Item | Verified result |
| --- | --- |
| Public URL | https://hostel-buddy-college-project.vercel.app |
| Framework/runtime | Native Express, Node.js 24 |
| Database | Turso resource `hostel-buddy-db`, connected to Production |
| Plan | Starter; installation output confirmed $0/month, no payment method required |
| Source implementation commit | `5912114` — author and committer Pranjal Tyagi |
| First verified deployment | `dpl_8VFX1ztxg3XrEvahwEXVeacgRbMb` |
| Subsequent production redeployment | `dpl_GR7vBRMG41NLBqseM1ii1M7ykyq3`, READY |
| API storage marker | `persistent-turso` |
| Direct database readiness | Schema initialization and admin login passed; foreign keys enabled (`1`) |

The existing JWT secret was retained. The owner explicitly requested the known
default admin password. It is enabled only through the demo opt-in setting;
this deployment must not hold real student data. No token, JWT, password hash
or generated test password is included in this evidence.

## Protected deployment verification

Before promoting the first deployment, authenticated Vercel CLI requests verified:

```text
Protected deployment health/storage: PASS
Protected deployment admin login: PASS
Protected deployment admin dashboard: PASS
```

The first deployment was then promoted to the public project URL.

## Executable live test code

The manual acceptance script is [tests/live-deployment-smoke.cjs](../tests/live-deployment-smoke.cjs).
It is excluded from automatic `npm test` because its `before` mode deliberately
creates isolated live fixtures. It requires `HB_LIVE_TEST_ALLOW_WRITE=true` and
the exact verified project URL. The unique roll number begins with `D0053-`;
the hostel/student are explicitly named Deployment Verification. The student
password is randomly generated and held only in an ignored local state file.

Execution environment (password supplied separately, never printed):

```powershell
$env:HB_LIVE_BASE='https://hostel-buddy-college-project.vercel.app'
$env:HB_LIVE_TEST_ALLOW_WRITE='true'
# Set HB_LIVE_ADMIN_PASSWORD securely in the process environment.
node tests/live-deployment-smoke.cjs before
# Perform a fresh production deployment, wait for READY and its stable alias.
node tests/live-deployment-smoke.cjs after
```

## Actual output before the new redeployment

```text
PASS: public API uses persistent Turso storage
PASS: admin login and role
PASS: admin creates a hostel
PASS: student registration with unique roll number
PASS: student cannot open admin dashboard
PASS: complaint creation and server-generated Critical priority / 2-hour SLA
PASS: duplicate detection finds the matching complaint
PASS: hotspot analytics includes the registered room
PASS: staff status update and SLA-met result
PASS: admin dashboard raised/resolved statistics
PASS: incorrect password rejected
Live acceptance mode complete: before
```

## Actual output after the new redeployment

```text
PASS: public API uses persistent Turso storage
PASS: admin login and role
PASS: same student account logs in after redeploy
PASS: pre-redeploy student token still authenticates (stable JWT secret)
PASS: same resolved complaint, priority and SLA survive redeploy
PASS: pre-redeploy admin token still authenticates
PASS: admin dashboard raised/resolved statistics
PASS: incorrect password rejected
Live acceptance mode complete: after
```

These are 19 labeled live assertions across both runs, with 0 reported failures.
The first run created the fixtures on one Vercel deployment, and the second run
retrieved the same identifiers and stored results from a different deployment.
This is actual cloud redeploy evidence, not just a local process-restart test.

After both runs passed, the exact generated test complaint, student and hostel
were removed in a transaction after validating their IDs and unique names.
The local test state containing generated credentials was also deleted. The
configured super-admin account and any unrelated data were left untouched.

## Local regression checks

- Node SQLite: 314 assertions passed, 0 failed, across the six existing suites.
- Actual libSQL SDK against a throwaway local file: same 314 assertions passed, 0 failed.
- Focused deployment suite: 7 test cases passed, 0 failed.
- `git diff --check`: passed.
- Compatible dependency patches: `npm audit` reported 0 known vulnerabilities at check time.

The local SDK file checks are not presented as live cloud results; the live
results above were executed separately against the public deployed API.

## Logs and limitations

Error-level Vercel Function log scans for both deployment IDs returned no matching
logs during verification. This is a bounded check, not ongoing monitoring.
No external log drain or continuous production monitor was configured by this task.

Attachments were not included in these tests. They still use temporary `/tmp`
storage on Vercel and require a separate object-storage/direct-upload upgrade.
Local/demo databases are not automatically migrated into the new cloud database.
Hostels and managers should be created through the super-admin UI.
