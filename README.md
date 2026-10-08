# eggdigital-assignment

Meeting Manager: Next.js frontend, Express backend and PostgreSQL, run locally as three Docker Compose services. Password login, current identity, JWT expiry and current-browser logout are implemented. NextAuth handles browser password/Google login and Google code exchange; Express issues API JWTs and verifies authoritative Gmail/Workspace identities; it does not connect Calendar or create meeting rooms. Meeting creation, creator edit/team/cancel/delete, Detail, private Interview Notes, Feedback and numeric pagination are implemented. Google login requires an existing Member; Online meetings use a manual HTTPS link. Automatic Calendar/Meet/Zoom integration is removed.

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

The frontend build must embed the public API URL `http://localhost:3001/api/v1`; no secrets belong in `NEXT_PUBLIC_*` settings. The limited authenticated landing shows identity/logout, not invented meeting data.

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

For standalone BE execution, inject `DATABASE_URL` pointing to your owned local database plus `JWT_SIGNING_KEY_BASE64`; the remaining defaults are `PORT=3001`, `ALLOWED_ORIGIN=http://localhost:3000`, fixed local JWT issuer/audience, TTL 900 and `COOKIE_SECURE=false`. Run `npm run migrate`, `npm run seed:login` (with private `LOGIN_FIXTURE_PASSWORD`), then `npm run dev` from `backend/`. Never expose database or signing values on the command line. HTTPS configurations require secure cookies. Compose is the verified local setup target; deployment is not included.
