# eggdigital-assignment

Meeting Manager: Next.js frontend, Express backend and PostgreSQL, run locally as three Docker Compose services. Password login, current identity, JWT expiry and current-browser logout are implemented. NextAuth handles browser password/Google login and Google code exchange; Express issues API JWTs and verifies authoritative Gmail/Workspace identities; it does not connect Calendar or create meeting rooms. Meeting creation, creator edit/team/cancel/delete, Detail, private Interview Notes, Feedback and numeric pagination are implemented. Google login requires an existing Member; Online meetings use a manual HTTPS link. Automatic Calendar/Meet/Zoom integration is removed.

## Application flow overview

1. **Login:** an existing Member signs in with a password or an eligible Google account. NextAuth handles the browser login; the backend verifies membership and issues the API JWT. Candidate identities are denied, including an email that also appears as a Member. Google login does not register new Members.
2. **Dashboard:** the Member selects a date and sees meetings they created or attend, grouped as upcoming/current, rejected/cancelled, and past. Upcoming/current meetings use numeric pages of 10. Dates are interpreted in `Asia/Bangkok`.
3. **Create:** enter meeting and candidate details, start/end times, and at least one other Member. Choose Onsite with location or Online with a manually supplied HTTPS join link. Saving creates the local meeting and attendee records; it does not create a Google/Zoom room, Calendar event or invitation email.
4. **Detail and management:** open a meeting to view its summary. Only its creator can edit meeting details/status, manage the team, cancel or delete it. Start/end times and meeting format are not editable through the edit API. Status values are `PENDING`, `CONFIRMED`, `REJECTED` and `CANCELLED`; cancellation uses its own action. A stale edit is rejected so the user can reload current data.
5. **Interview content:** the creator and authorized attendees can keep their own private Interview Notes and read meeting Feedback. Each author has at most one feedback entry per meeting and can edit only their own entry. Feedback uses numeric pages of 50. Access is checked again when saving; another user's private notes are not exposed.
6. **Logout or expiry:** logout clears the current browser's NextAuth/API authentication state. Expiry requires login again; logout does not revoke copied JWTs or other browser sessions.

The browser talks to Next.js for login and to Express for meeting data. Express validates identity, authorization and inputs before using parameterized PostgreSQL queries. In production, browser API traffic must stay on the frontend's public origin through the `/api/v1` proxy described below.

## Local setup

Requires Docker with Compose and Node.js 24.19 or a compatible Node 24 release. Keep actual secrets only in local ignored files; never copy them into `.env.example` or logs.

1. Keep the existing root `.env`. On a fresh checkout, copy `.env.example` to `.env` and fill Google fields only when configuring Google login. Blank Google configuration does not block password login.
2. Install backend tooling and generate separate private local database/JWT/test-fixture credentials. Compose loads this local runtime file after root `.env`, so its local database/JWT/fixture values take precedence and blank example placeholders cannot mask them. Google fields still come from root `.env`. The separate ignored `backend/.bridge.local.env` supplies a shared server caller key and an independent NextAuth secret; `setup:bridge` preserves an existing file. This command preserves any existing `backend/.local.env` and never overwrites root `.env`:

   ```sh
   npm ci --prefix backend
   npm run setup:local --prefix backend
   npm run setup:bridge --prefix backend
   ```

3. Start the local services:

   ```sh
   docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env up --build -d
   docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env exec backend npm run seed:login
   ```

   Open `http://localhost:3000/login`. The backend listens at `http://localhost:3001`. PostgreSQL has no published port. Compose explicitly constructs its database URL for the owned `db` service; it does not migrate a database URL taken from an unknown remote environment. Migrations run before backend startup and retain history. Normal restarts retain the named database volume.

4. The synthetic local member is `sample01@example.test`. Its generated password is `LOGIN_FIXTURE_PASSWORD` in your private `backend/.local.env`; inspect it locally, not in shared logs/chat. `candidate01@example.test` deliberately overlaps Candidate and member roles and must be denied. These fixtures are not real Google accounts. Seed is idempotent and preserves existing rows; changing a fixture password setting does not silently replace an existing user's stored hash.

Useful operations:

```sh
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env ps
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env logs --tail=60 backend
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env stop
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env up -d
```

After intentionally changing local configuration, recreate the affected service with `up -d --force-recreate backend`. Do not use `docker compose config` without `--quiet` in shared output: expanded configuration contains secrets. Do not use `down -v` as a normal stop; it deletes local database data.

## API and frontend integration

All endpoints use JSON and `Cache-Control: no-store`. Browser requests use `credentials: 'include'`. POST requests require `Origin: http://localhost:3000`, `Content-Type: application/json`, and `X-Requested-With: MeetingManager`. Browser endpoints never return an app JWT in the response body. The authenticated internal issuer returns it only to the Next server.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/auth/session` | Resolve current identity and fixed expiry without renewal |
| POST | `/api/v1/auth/logout` | Clear API/legacy transaction cookies; no database or JWT required |
| GET | `/api/v1/health/ready` | Database readiness |

The retired POST `/api/v1/auth/login`, `/api/v1/auth/google/start`, and `/api/v1/auth/google/exchange` return 404. Start browser login from the Next frontend `/login`; NextAuth and its completion bridge own browser login state. The previous frontend `/auth/google/callback` is retired. L4 session and L5 clear-only logout remain available for compatibility.

Google's active web application redirect is `http://localhost:3000/api/auth/callback/google`; origin is `http://localhost:3000`. The client secret is server-only. Configure the provider registration deliberately; do not automatically overwrite an existing provider setting. Legacy backend exchange files remain for compatibility but their login routes are disabled. No provider token is saved for Calendar, and no Google identity is automatically inserted as a member. Non-authoritative third-party email admission is not enabled. Actual Google login requires an authorized provider account/consent setup and is separate from controlled test fixtures.

The private server route `POST /internal/auth/issue` accepts `{method:"password",email,password}` or `{method:"google",idToken}` with `X-Auth-Service-Key` and JSON. It returns an Express-signed `accessToken`, expiry and current user to the authenticated Next server only; it sets no cookie. NextAuth completion delivers that same token as HttpOnly `mm_access`. Optional `X-Request-ID` is accepted only as a UUID; otherwise a server request ID is used. The route is outside browser CORS and requires its separate caller key. The Express signing key is never provided to Next. An unset caller key disables internal issuance safely.

There is no login-attempt rate limit or count-based lockout for password or Google. Authentication, Candidate denial, expiry, CSRF, one-use OAuth state and bounded transient state protection remain. The internal B1 slice and the FE NextAuth browser flow have separate validation evidence; the three legacy Express login entry routes are retired (404).

For local development, the frontend uses the public API URL `http://localhost:3001/api/v1`; no secrets belong in `NEXT_PUBLIC_*` settings. The authenticated application includes meeting lists, create/edit/detail flows, cancellation/deletion, interview notes and feedback, and numeric pagination.

Browser logout coordinates cancellation and clearing of NextAuth state and API cookies. Express L5 alone clears only API/legacy transaction cookies and is not the complete NextAuth logout flow. Other browsers and copied JWTs are not revoked. JWTs expire at their original deadline (default 900 seconds); each protected request rechecks current database and Candidate status. The NextAuth bridge guards completion against cancellation and waits for in-flight work before final clearing; discarding JavaScript results alone does not undo `Set-Cookie`.

## Development and checks

The frontend and backend have separate package manifests and lockfiles. Each can be installed independently. The backend uses strict TypeScript and routes → controllers (`req`, `res`, `next`) → services → parameterized PostgreSQL models. It has no runtime session/revocation table or persistent Google account linking.

```sh
npm run typecheck --prefix backend
npm run build --prefix backend
npm test --prefix backend
npm run test:integration:isolated --prefix backend
npm run smoke:local --prefix backend
```

The isolated integration command creates a uniquely named PostgreSQL test container, applies migrations and synthetic fixtures, runs real SQL/HTTP checks, then removes only that container and verifies removal. It never uses root `.env` or a production database. Controlled Google fixtures verify application behavior but do not prove a real Google account login.

`smoke:local` checks the running backend readiness, three retired routes, unauthenticated session/internal-issuer denial, and clear-only logout/CSRF. It loads no credentials, performs no database writes and does not restart services. It does not replace authenticated issuer, real PostgreSQL, browser NextAuth, or genuine provider tests.

For standalone BE execution, inject `DATABASE_URL` pointing to your owned local database plus `JWT_SIGNING_KEY_BASE64`; the remaining defaults are `PORT=3001`, `ALLOWED_ORIGIN=http://localhost:3000`, fixed local JWT issuer/audience, TTL 900 and `COOKIE_SECURE=false`. Run `npm run migrate`, `npm run seed:login` (with private `LOGIN_FIXTURE_PASSWORD`), then `npm run dev` from `backend/`. Never expose database or signing values on the command line. HTTPS configurations require secure cookies. Compose is the verified local setup target; Railway preparation and outstanding deployment prerequisites are below.

## Applying database migrations

Migrations and seeds are separate operations. Migrations apply pending schema changes and record their names in `pgmigrations`; an ordinary rerun skips already recorded migrations. They do not reset the database. Keep the existing history and migration files intact, and back up a non-disposable database before applying schema changes.

### Local Docker Compose

Complete Local setup first. Compose injects `DATABASE_URL` for its own `db` service from the private `backend/.local.env`; do not paste a connection string or password into a command. The backend's normal Compose startup already runs `npm run migrate` before starting the server, so no additional migration step is needed for normal startup.

To deliberately apply newly added pending migrations while the backend container is running, execute from the repository root:

```sh
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env exec backend npm run migrate
```

If the backend is stopped, start the database and run a one-off migration container instead:

```sh
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env up -d db
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env run --rm backend npm run migrate
```

Inspect the recorded history and, after starting the backend, its HTTP readiness:

```sh
docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env exec db psql -U meeting_manager -d meeting_manager -c 'SELECT name, run_on FROM pgmigrations ORDER BY id;'
curl --fail http://localhost:3001/api/v1/health/ready
```

The current migration set contains 11 files. Compare their names with the history; a healthy HTTP response alone does not prove that every expected migration is present. Local fixture creation is the separate `npm run seed:login` command from Local setup. Do not delete the volume or migration history to rerun a migration.

### Railway production image

This path is **prepared but not deployed or verified against a production database**. First confirm the intended Railway project/environment/backend service and PostgreSQL target. Set `DATABASE_URL` privately in that backend service's Railway Variables; the migration command requires this variable and no fixture password. Application startup separately requires the backend settings listed in Railway deployment preparation.

The backend Dockerfile copies the existing `migrations/` and `scripts/migrate-production.mjs` into the runtime image; `node-pg-migrate` and `pg` are production dependencies. Set the service's **Pre-deploy Command** to:

```sh
node scripts/migrate-production.mjs
```

Railway runs this command inside the deployment image with the service variables and private-network access. It applies pending migrations only; failure must block deployment. Do not use the local-only `npm run migrate` command against Railway and do not configure a production seed command. Running the production command manually is appropriate only inside the confirmed backend service environment after checking its target; never substitute an unknown local or remote database URL.

To inspect history, run this read-only SQL in the confirmed database's query console:

```sql
SELECT name, run_on FROM pgmigrations ORDER BY id;
```

After deployment, verify `/api/v1/health/ready` through the configured frontend public origin or the backend service's private network. A read-only check from inside the backend container uses its injected `PORT`:

```sh
node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/v1/health/ready").then(r => { console.log("readiness", r.status); process.exitCode = r.ok ? 0 : 1; }).catch(() => { console.error("Readiness check failed"); process.exitCode = 1; })'
```

No database provisioning, migration execution, seeding or destructive reset is performed by these documentation changes.

## Current database schema

This overview describes the cumulative result of the **11 migrations in `backend/migrations`**, including retained historical tables. `pgmigrations` is maintained separately by the migration runner. The migration files are the executable source for all column definitions, indexes and constraints.

| Table | Key columns and relationships | Purpose |
|---|---|---|
| `users` | PK `id`; unique normalized `email`; `display_name`, nullable `password_hash`, `created_at` | Existing Members. No separate roles or Google-account-link table. |
| `meetings` | PK `id`; FK `creator_id → users.id`; unique `(creator_id, create_request_id)` | Title, description, candidate name/email, position, `starts_at`, `ends_at`, status, format, location, preparation notes, `manual_join_url`, historical provider identifiers, creation/update times. |
| `meeting_attendees` | PK `(meeting_id, email)`; FK `meeting_id → meetings.id`; nullable FK `member_id → users.id`; `display_name` | A meeting's team; email/display name are stored on the attendee record. |
| `deleted_meeting_requests` | PK `(creator_id, create_request_id)`; FK `creator_id → users.id`; unique `meeting_id` **without** a meeting FK | Remembers deleted create requests so retries cannot recreate the deleted meeting. |
| `interview_notes` | PK `(meeting_id, author_key)`; FK `meeting_id → meetings.id ON DELETE CASCADE`; `content`, `updated_at` | One private note per author per meeting. `author_key` is an application identity, not a database FK to `users`. |
| `meeting_feedback` | PK `id`; FK `meeting_id → meetings.id ON DELETE CASCADE`; unique `(meeting_id, author_key)` | `author_name`, `create_request_id`, content and timestamps; one feedback entry per author per meeting. `author_key` is not a user FK. |
| `local_demo_seed_runs` | PK `dataset_key`; `fixture_version`, `manifest_sha256`, `applied_at` | Local fixture bookkeeping retained in schema; production startup does not seed data. |
| `provider_connections` | PK `id`; FK `creator_id → users.id`; unique `(creator_id, provider)` | **Retained history:** provider identity, scopes, encrypted credential fields, version, expiry and connection status. No active provider-connection feature. |
| `meeting_provider_operations` | PK `(creator_id, request_id)`; unique `operation_id`; FKs to `users` and `provider_connections`; `meeting_id` has no FK | **Retained history:** external room/calendar identifiers, join URL, operation phase and failure state. |
| `meeting_calendar_links` | PK/FK `meeting_id → meetings.id`; FK `connection_id → provider_connections.id`; unique `(connection_id, calendar_id, event_id)` | **Retained history:** calendar/event link metadata. |
| `meeting_provider_cleanup` | PK `meeting_id` **without** a meeting FK; unique `operation_id`; FKs to `users` and optional provider connections | **Retained history:** previous cancel/delete cleanup state and external identifiers; no active external cleanup executor. |

The main relationships are **Member → created meetings → attendees / notes / feedback**. Candidate details live on `meetings`; there is no separate Candidate table. Meetings support `ONSITE` and `ONLINE`; current Online creation requires a manual HTTPS link. The database also retains compatibility with historical provider-backed Online rows. Meeting end time must be after start time. Creator/request uniqueness supports create retry handling. The final manual-link migration refuses an automatic destructive rollback; reconcile data explicitly before any downgrade.

## Railway deployment preparation

**Status: configuration/code prepared; no Railway deployment verified.** The actual project, environment, frontend/backend services, database, public domain and secret values still need to be confirmed. Do not treat the existence of CI or a Dockerfile as a successful deployment.

Use Railway's native GitHub integration for the selected branch and enable **Wait for CI**. `.github/workflows/backend-ci.yml` runs installation, type checking, unit/API tests, isolated PostgreSQL tests, a TypeScript build and a production Docker image build. Confirm the remote checks succeed before release. Avoid adding a second CLI autodeploy route for the same service. Railway currently deprecates legacy `railway.json`/`railway.toml` configuration; the service settings below must be applied to the confirmed target (or translated to its supported IaC setup).

| Setting | Backend service | Frontend service |
|---|---|---|
| Repository root | `/backend` | `/frontend` |
| Builder | `Dockerfile`, final `runtime` stage | `Dockerfile`, final `runtime` stage |
| Start | `node dist/server.js` | `npm run start` |
| Port | Railway-provided `PORT`; binds `0.0.0.0` | Railway-provided `PORT`; binds `0.0.0.0` |
| Pre-deploy command | `node scripts/migrate-production.mjs` | None |
| Readiness path | `/api/v1/health/ready` (database readiness) | `/login` (HTTP readiness only) |

The production migration command applies only the existing ordered migrations, with locking and a transaction. It uses `DATABASE_URL` from the service environment and does not run automatically on normal application startup. It does not seed users or reset data. The separate local migration command retains its local-database restriction. Validate the production image and migration command against an isolated database before using a production target; those new packaging checks have not yet been completed locally.

Configure these variables in Railway's private service settings, never in committed files:

- **Backend:** `DATABASE_URL` for the confirmed PostgreSQL service; `JWT_SIGNING_KEY_BASE64` encoding at least 32 random bytes; `AUTH_SERVICE_KEY` shared only with the Next server; `GOOGLE_CLIENT_ID` matching the frontend Google client; `ALLOWED_ORIGIN` equal to the frontend's exact HTTPS origin; `COOKIE_SECURE=true`. Retain the existing fixed `JWT_ISSUER=urn:meeting-manager:local` and `JWT_AUDIENCE=urn:meeting-manager:api` contract; the default access lifetime is 900 seconds.
- **Frontend build and runtime:** `NEXT_PUBLIC_API_BASE_URL=/api/v1` and `API_PROXY_ORIGIN` equal to the backend's private HTTP(S) origin, including its actual service port. Supply both as Docker build arguments as well as runtime variables; the Next rewrite destination is embedded during build. The origin must have no credentials, path, query or fragment. Rebuild if it changes.
- **Frontend server only:** `AUTH_BACKEND_INTERNAL_URL` equal to the private backend origin; matching `AUTH_SERVICE_KEY`; independent `NEXTAUTH_SECRET`; `COOKIE_SECURE=true`; `NEXTAUTH_URL` equal to the public frontend HTTPS origin; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` when enabling Google login. Register the exact frontend HTTPS URL plus `/api/auth/callback/google` with Google. Never expose private keys or secrets through `NEXT_PUBLIC_*`.

Browser traffic uses **frontend public origin → `/api/v1` proxy → private backend**; `/api/auth` remains on NextAuth. This preserves the host-only HttpOnly authentication cookie. Calling a separately hosted public backend directly would not receive that frontend cookie. Do not widen the cookie domain to compensate. Use one frontend replica because authentication-attempt state is held in process memory, and one backend replica because pagination signing state is held in process memory. Reload lists after a backend restart. The backend binds IPv4 `0.0.0.0`; select a Railway environment with IPv4-capable private networking and verify frontend-to-backend connectivity before release. Do not assume compatibility with an IPv6-only private network.

Before declaring deployment complete, verify the selected commit and successful CI, applied migrations, database readiness, frontend login, authenticated same-origin meeting requests, logout and the actual registered Google callback. An empty production database also needs deliberately provisioned legitimate Members; local synthetic seed commands are not a production onboarding process. Target selection, secrets, Member provisioning and actual Railway/browser checks remain pending.

Official deployment references: [GitHub autodeploy and Wait for CI](https://docs.railway.com/deployments/github-autodeploys), [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), and [configuration status](https://docs.railway.com/config-as-code/reference).

## Interactive wireframe

ดู [ภาพรวม flow และวิธีติดตั้ง/เปิดต้นแบบ](doc/README.md): Login → Member/Guest → รายการนัด → Add/Edit/ทีม/Cancel/Delete → Summary พร้อม Notes ส่วนตัวและ Feedback

ต้นแบบอยู่ใน `doc/` ใช้ข้อมูลสมมติและ local static server ไม่ต้องรัน backend ดู [Wireframe](doc/index.html) หรือ [UI design](doc/ui-design.html) โดยดาวน์โหลด/clone แล้วเปิดตามขั้นตอนในคู่มือ

ส่วนนี้เป็นต้นแบบที่เก็บไว้เพื่ออ้างอิงการออกแบบ เส้นทาง Member/Guest ในต้นแบบไม่ใช่สิทธิ์ของแอปปัจจุบัน ซึ่งอนุญาตให้เข้าสู่ระบบเฉพาะ Member ตาม Application flow overview ด้านบน
