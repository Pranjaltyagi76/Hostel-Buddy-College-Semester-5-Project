# Hostel Buddy: persistent Vercel deployment

## What was wrong

The old deployment stored accounts in SQLite under `/tmp`. That directory is
temporary and is not shared between Vercel Function instances. Accounts created
on one instance could disappear on a cold start or be absent on another instance.
Frontend requests already use same-origin `/api`; changing them to localhost
would not fix account storage.

The Express builder imports `src/app.js`, rather than running `npm start`.
Schema initialization and first-admin creation therefore have to run in the
imported API path as well as the local server startup path.

On 4 October 2026, the public health endpoint was checked again and returned
HTTP 200 with `storage: "ephemeral-demo"`. The linked project had no provisioned
database resources. This confirms that the live site was still on the old code.

## Implemented fix

- `src/db/connection.js`: awaited SQLite/libSQL statements and request-local
  transaction context. Local SQLite transactions are serialized across awaits.
- Repositories, services and controllers await database-dependent work; existing
  complaint validation, ownership, manager scoping and novelty rules are retained.
- `src/db/prepare.js`: shared, retryable initialization. API requests await it,
  including `/api/health`; health also performs a real database query.
- Only the first super-admin account is bootstrapped. Demo users/passwords are
  not seeded in production. Simultaneous bootstrap checks are transactional.
- A Vercel runtime without a remote database URL/token fails configuration
  validation instead of silently falling back to temporary SQLite.
- The browser displays invalid credentials as invalid credentials, not an
  expired session. HTML returned by an API route produces a routing error.
- Compatible dependency security patches were applied; no forced major upgrades.

Vercel's native Express integration uses the exported app in `src/app.js`.
Do not add legacy `api/index.js` catch-all rewrites on top of that integration.
The existing project is linked under `pranjal-tyagi-ai/hostel-buddy-college-project`.

## Provision the database

1. In the authenticated Vercel account, review and accept the Turso Marketplace
   terms at https://vercel.com/pranjal-tyagi-ai/~/integrations/accept-terms/tursocloud?source=cli.
   The CLI cannot finish a first-time installation until the account owner does this.
2. From the linked project directory, provision a free database for production:

   ```powershell
   npx --yes vercel@61.0.0 integration add tursocloud/database --name hostel-buddy-db --plan starter -e production --no-env-pull --format=json
   ```

   The installed Starter plan was verified as $0/month, with no payment method required.
   If the provider rejects a plan ID, inspect the available plans before proceeding;
   do not silently select a paid plan.
3. Confirm that the resource is connected to this project and that Vercel has
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Inspect names only with
   `npx --yes vercel@61.0.0 env ls production`.

Use a separate test database for preview/development. Never point automated test
suites at the production database. Never paste database tokens into chat or Git.

## Admin credentials and secrets

In Vercel Project Settings > Environment Variables, set these for Production:

| Variable | Requirement |
| --- | --- |
| `TURSO_DATABASE_URL` | Remote `libsql://` or `https://` database URL |
| `TURSO_AUTH_TOKEN` | Database write token; server-only secret |
| `JWT_SECRET` | Strong random secret; keep unchanged across redeploys |
| `ADMIN_EMAIL` | Email to use for the first super admin, e.g. `admin@hostel.test` |
| `ADMIN_PASSWORD` | Strong password recommended; default rejected unless demo opt-in is enabled |
| `ADMIN_NAME` | Optional display name |
| `ALLOW_DEMO_ADMIN_PASSWORD` | `false` by default; `true` permits `admin123` for a class demo only |

The old project had a hidden generated `ADMIN_PASSWORD`, not the assumed demo
password. Its value is not recoverable through a sensitive env pull. For this
class demo, the owner explicitly requested retaining `admin123`, so Production
is being configured with that value and `ALLOW_DEMO_ADMIN_PASSWORD=true`.
This is a weak, publicly known credential: do not use real student data. The
exception keeps strong JWT-secret and persistent-database checks in place.

The account is created only when the email is absent. Updating `ADMIN_PASSWORD`
later **does not reset a stored password**. If an existing account needs recovery,
use an explicit, authorized password-reset operation against that exact account;
do not delete the database or silently overwrite credentials on every cold start.

The old ephemeral demo database and local `data/hostel.db` are not automatically
copied into Turso. The new database starts with just the configured super admin.
Create hostels and managers through the normal admin UI, then register students.
If local data must be preserved in the cloud, back it up and perform a separately
reviewed migration before the first-admin bootstrap.

## Verify and deploy

Local checks:

```powershell
npm ci
npm test
npm run test:deployment
$env:HB_TEST_DATABASE_BACKEND='libsql'
npm test
Remove-Item Env:HB_TEST_DATABASE_BACKEND
git diff --check
```

The suite runner forces a throwaway database and clears inherited cloud
credentials. libSQL-mode API tests use the actual SDK with a temporary local
SQLite file; they are **not** a live Turso network test.

Before pushing, verify Git author and committer are Pranjal Tyagi with the existing
verified repository email. Commit only the deployment changes, excluding local
secrets, database files, uploads, presentations and unrelated test artifacts.
Do not add an assistant co-author. Push to the existing GitHub remote when the
production database/environment are ready.

Deploy the linked project after verifying the production env names:

```powershell
npx --yes vercel@61.0.0 deploy --prod --yes
```

The existing Git connection was previously unavailable; a push alone does not
prove that Vercel deployed the new code. Check the deployment status and stable URL.

## Required live acceptance checks

1. `https://hostel-buddy-college-project.vercel.app/api/health` returns JSON,
   HTTP 200 and `storage: "persistent-turso"`.
2. Log in using the configured admin email/new password. Open its dashboard.
3. Create a hostel, register a test student with a unique email/roll number, and
   log in as that student.
4. Create a complaint without attachments; verify its priority/SLA, dashboard
   count and duplicate/hotspot views through the appropriate staff role.
5. Redeploy. Confirm that the same student can still log in and retrieve the
   complaint. A fresh process test alone is not evidence of this cloud redeploy.
6. Scan Vercel Function error logs. For a 500 health response, inspect database
   credentials, network access and bootstrap errors before attempting login again.

## Actual verification recorded locally

On 4 October 2026, after the compatible dependency patches:

- Node SQLite: 314 API assertions passed, 0 failed, across six suites.
- libSQL SDK using a temporary local file: the same 314 assertions passed, 0 failed.
- Deployment suite: 7 test cases passed, 0 failed (imported app initialization,
  account/session persistence across a new process on both backends, transaction
  commit/rollback and foreign keys on both, unsafe Vercel config rejection, and
  browser credential/routing-error handling, and explicit demo-password opt-in).
- `git diff --check` passed.
- `npm audit fix` reported 0 remaining known vulnerabilities at execution time.

The owner subsequently accepted Marketplace terms, and `hostel-buddy-db` was
provisioned on the verified free Starter plan and connected to Production.
Live login/redeploy results are recorded separately after cloud verification.

## Attachment limitation (outside this database/login fix)

Vercel attachments remain in `/tmp`, so they are temporary and instance-specific.
Database durability does not preserve those files. Vercel's request-body limit
also prevents the large video uploads advertised by the current frontend.
Durable attachments require object storage plus a direct browser upload flow.
Complaint flows without attachments can be verified after database deployment.
