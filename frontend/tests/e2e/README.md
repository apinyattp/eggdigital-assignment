# End-to-end tests: local and CI

This suite exercises the production Next.js frontend, actual NextAuth password routes, Express API, and a disposable PostgreSQL 18 database. The same isolated real-stack entry point runs locally and in GitHub Actions. No production account, deployed URL, external identity provider, or existing database is required.

The scenario matrix below describes assertions in the scripts, not an assertion that a particular run passed. Read that run's `results.json` files and exit status for execution evidence. Browser tests complement the unit and PostgreSQL integration suites; they do not replace them or establish exhaustive coverage.

## Run

Use Node 24.19.x, npm, a POSIX shell/process environment, a local Docker daemon, and a clean checkout without application `.env` files. Remote Docker contexts are refused. The runner supplies its own application configuration and refuses local `.env` files rather than mixing test and existing settings. Install dependencies and browser binaries once:

```sh
npm ci --prefix backend
npm ci --prefix frontend
cd frontend
npx --no-install playwright install chromium webkit
cd ..
```

Check the typed database fixture (also checked by the E2E workflow):

```sh
npm --prefix backend run typecheck:e2e
```

Run Chromium from the repository root:

```sh
npm --prefix frontend run test:e2e
```

Run both browser engines serially:

```sh
E2E_BROWSERS=chromium,webkit npm --prefix frontend run test:e2e
```

The full selection defines 27 scenarios per browser: 9 auth/session cases, 13 meeting/content/navigation cases, and 5 authorization/private-note cases. `test:e2e:local` remains an alias of the same entry point.

Run one suite:

```sh
E2E_SUITE=auth npm --prefix frontend run test:e2e
```

Run exactly one scenario, using its full ID from the matrix:

```sh
E2E_SUITE=auth E2E_CASE=E2E-AUTH-03-mobile-logout-and-reload npm --prefix frontend run test:e2e
```

`E2E_CASE` requires `E2E_SUITE`. It is an exact ID, not a regular expression or Playwright Test `--grep` flag. Invalid suite names, a case without its suite, and an ID not found in the selected suite fail instead of silently passing or running a different selection. Single-case runs still build and start the isolated stack.

Use `E2E_BROWSERS=webkit` to request only WebKit. Browser binaries and any required operating-system libraries must be installed. A missing WebKit runtime or launch dependency is a reported blocker, not a successful or silently skipped test. Playwright WebKit on the host is not an iPhone or proof of behavior on physical iOS Safari.

Optional environment settings:

| Setting                      | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `E2E_BROWSERS`               | `chromium` (default), `webkit`, or `chromium,webkit`.                       |
| `E2E_SUITE`                  | Select `auth`, `meetings`, or `authorization`; omitted means all three.     |
| `E2E_CASE`                   | Exact scenario ID within the required `E2E_SUITE`.                          |
| `PLAYWRIGHT_EXECUTABLE_PATH` | Existing Chromium executable; applies only to Chromium.                     |
| `PLAYWRIGHT_BROWSERS_PATH`   | Location of Playwright-installed browser binaries.                          |
| `DOCKER_CONFIG`              | Docker CLI configuration directory, if the default is unavailable.          |
| `E2E_EVIDENCE_DIR`           | Local output directory; defaults to `frontend/e2e-results/<run-id>`.        |
| `E2E_HEADED=1` / `PWDEBUG=1` | Open the browser for local debugging when a graphical display is available. |
| `E2E_TRACE=1`                | Explicitly collect unredacted local traces on failure; ignored in CI.       |

For example, a Linux environment with an existing Chromium binary can use:

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm --prefix frontend run test:e2e
```

Run the same single scenario in a visible browser from a graphical session:

```sh
E2E_HEADED=1 E2E_SUITE=auth E2E_CASE=E2E-AUTH-03-mobile-logout-and-reload npm --prefix frontend run test:e2e
```

Open Playwright Inspector for that scenario:

```sh
PWDEBUG=1 E2E_SUITE=auth E2E_CASE=E2E-AUTH-03-mobile-logout-and-reload npm --prefix frontend run test:e2e
```

Builds and scenario setup still run normally. There is no skip-build option. The runner keeps a 28-minute overall deadline, 10 minutes per suite, and bounded fixture/build/startup timeouts during debugging; Inspector pauses do not disable those limits.

Do not point the scripts at a deployed application. The runner chooses unused local ports, generates per-run credentials/signing keys, builds both applications, and starts its own services. Browser contexts reject HTTP traffic to non-loopback hosts. `fixture.mjs` requires the runner's ownership token and checks the owned database/container before it can reset, inspect, or change fixture data. The internal fixture environment variables are not a supported way to target a pre-existing database.

Run one invocation at a time in a checkout. It writes production build directories, resets fixture data between scenarios, and executes suites and browser engines serially. The PR description records the tested commit/base and any unmerged implementation dependencies; verify the checkout whose behavior you intend to test.

## What the entry point starts

The runner creates and verifies its own loopback-only PostgreSQL container, then runs the fixture script’s `init` action. That action applies the repository migrations and establishes a per-run ownership guard. Each scenario resets and seeds synthetic Members, meetings, team membership, private notes, and older feedback.

It builds the backend with `npm run build`, builds the production frontend with `npm run build`, starts `node dist/server.js` in the backend, and starts the Next.js production server on its generated local port. Readiness checks must succeed before scenarios start. The fixture script and server commands require the runner-generated environment; use the public entry point rather than invoking them against your own database.

Application settings such as `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AUTH_SERVICE_KEY`, and `JWT_SIGNING_KEY_BASE64` are generated for the run. No values for those variables need to be supplied. Their conceptual values are `<owned loopback database URL>`, `<generated local frontend origin>`, and `<generated per-run secret>`; these are descriptions, not credentials to paste into an `.env` file. Existing application/database credentials are not inherited.

## Evidence and cleanup

The evidence root contains `run.json` with the checkout commit, dirty-state indicator, requested browsers/filters, timestamps, and run status, without application environment values. Each browser/suite directory contains `results.json` with scenario IDs, PASS/FAIL status, and evidence scope. Successful scenarios capture a screenshot. Trace capture is off by default. A failed local scenario retains a trace only when `E2E_TRACE=1` is explicitly set and capture succeeds; CI never collects traces.

Ordinary scenario failures are recorded without automatically retrying the case. The failed case’s browser contexts are closed, and the next independent case starts with a reset fixture. A suite returns a failing exit status if any selected case failed; after that child process exits, the runner continues collecting the remaining selected suites and browsers. Any failed suite makes the overall run fail.

Runner initialization, build/readiness failures, timeouts, and interruptions stop further execution and enter cleanup. A missing scenario result is never a PASS: compare it with the browsers, suite, and case requested in `run.json`. It may have been excluded by a filter or may not have completed because setup or execution stopped. Read every available `results.json`, the overall manifest status, and any reported failed suites together.

This harness uses the Playwright browser library directly, so it produces JSON and screenshots rather than a Playwright Test HTML report. Read the JSON for a specific run (replace `<run-id>` with the directory printed by the runner):

```sh
cat frontend/e2e-results/<run-id>/chromium/auth/results.json
```

To opt in to a private, unredacted local failure trace, set `E2E_TRACE=1` on the test invocation:

```sh
E2E_TRACE=1 E2E_SUITE=auth E2E_CASE=E2E-AUTH-03-mobile-logout-and-reload npm --prefix frontend run test:e2e
```

The trace may contain per-run synthetic credentials, cookies, and request bodies. Do not publish it. Successful scenarios do not save a trace.

Inspect a saved local failure trace:

```sh
cd frontend
npx --no-install playwright show-trace /absolute/path/to/E2E-AUTH-03-mobile-logout-and-reload-actor-0-trace.zip
```

Traces and private diagnostics can include generated, temporary test credentials and request bodies. They stay local and are not uploaded or committed. Failure screenshots mask password inputs and the JSON report redacts the generated fixture password; CI uploads only those screenshots, JSON reports, and the safe `run.json` manifest. The evidence directory is ignored by Git. Use the runner's printed private diagnostic path when startup/build/test execution fails; do not paste its raw logs or fixture data into a public report.

On normal completion, failure, or handled interruption, the runner terminates its own application children, removes only the PostgreSQL container bearing its run ownership label, verifies the container is absent, and deletes the generated fixture credential file. Successful runs remove their temporary diagnostic directory. Cleanup failure is reported and makes the run fail. An uncatchable process/host termination may still require checking the specific owned container named in the diagnostics; never remove unrelated containers as part of test cleanup.

## GitHub Actions

[`.github/workflows/e2e-ci.yml`](../../../.github/workflows/e2e-ci.yml) defines the **Real-stack E2E** workflow. It runs for pull requests, pushes to `main`, and manual dispatch. The `chromium` and `webkit` matrix jobs run one at a time on `ubuntu-latest`, each with a 35-minute timeout. The workflow installs Node 24.19.0, both application dependency sets, and the selected browser plus host libraries, then calls the same real-stack entry point used locally.

Both jobs use an owned loopback PostgreSQL container and generated application secrets. They do not need repository database/login/provider secrets and do not contact a deployed application. A failed browser job fails its check; the other browser still runs because the matrix has `fail-fast: false`.

On failure, the workflow uploads only password-masked PNG screenshots, redacted `results.json` files, and the safe `run.json` manifest, if produced, as `e2e-<browser>-failure`, retained for three days. Traces, fixture files, and private runtime logs are not CI artifacts. Open the workflow run in GitHub Actions to see job status and download available failure evidence. The runner also prints each already-redacted scenario result to the job log. Browser-launch failures record only the stage, error name, and script line; earlier startup failures can occur before any scenario artifact exists.

These workflow definitions are not execution evidence by themselves. Inspect the run for the submitted commit and both browser-job conclusions. Required merge checks depend on the repository’s branch-protection settings.

## Evidence scopes

- **Real stack:** Browser interactions use actual local application endpoints and PostgreSQL. Fixture seeding, inspection, membership removal, and issuance of an already-expired token are explicit local test setup actions. They do not add application endpoints or bypass authorization for the actions under test.
- **Injected failure/timing:** The browser runs against the same real stack, but a named request is delayed, aborted, or replaced with a failure. These scenarios demonstrate client recovery and safe handling of a controlled failure. They are not evidence that an actual network or database failure happened naturally.
- **Other automated coverage:** Existing unit/HTTP/PostgreSQL tests cover contracts or race boundaries that the new browser scenarios do not fully explore. References below identify those limits; they are not counted as browser passes.

The login helper waits for the real successful identity and dashboard API bodies before a scenario can navigate again. Logout checks inspect raw cookies first: absence or an empty, already-expired deletion marker is accepted (WebKit may retain such markers in its inspection API); nonempty, session-lifetime, or future-expiry cookies fail. Browser-origin session rejection and protected-route denial are separate assertions.

Each scenario starts with an independently reset fixture and fresh browser context. Accounts and candidate names use synthetic data. The password flow is real; genuine Google OAuth is outside this local suite. Existing [`auth-library.browser.mjs`](../auth-library.browser.mjs) separately exercises real NextAuth route behavior with a controlled identity provider/backend, and [`auth.browser.mjs`](../auth.browser.mjs) uses mocked auth responses. Neither should be described as real Google or real PostgreSQL evidence.

## Requirement-to-scenario matrix

IDs below are test inventory identifiers, not new product requirements. Assertions follow current application/service behavior and existing `TEST-MM-*` cases. The interactive `doc/` prototype is not an authorization specification: its simulated Guest flows do not grant access in the implemented Member-only application.

### Authentication and session ownership

Implemented in [`auth.browser.mjs`](auth.browser.mjs).

| Scenario                                        | Requirement / observable assertion                                                                                                                                                                                     | Scope                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `E2E-AUTH-01-password-and-protected-route`      | Anonymous protected navigation returns to login; required email validation and wrong-password rejection; real password login, current server identity, and reload persistence.                                         | Real stack                                     |
| `E2E-AUTH-02-candidate-and-password-ineligible` | A meeting-linked Candidate is denied even with a password; a password-ineligible account does not gain access through password login.                                                                                  | Real stack                                     |
| `E2E-AUTH-03-mobile-logout-and-reload`          | Mobile-width touch logout removes application/NextAuth session cookies or leaves only empty, already-expired deletion markers; browser-origin session API returns 401; reload and protected navigation stay anonymous. | Real stack; mobile emulation                   |
| `E2E-AUTH-04-keyboard-and-account-switch`       | Keyboard opens account menu; Escape restores focus; Enter logs out; signing in as another account replaces identity in the same browser context.                                                                       | Real stack; keyboard                           |
| `E2E-AUTH-05-expired-signed-token`              | A locally signed, expired JWT is rejected by the real server while cookie scope/expiry remain intact; protected UI loses the old identity.                                                                             | Real stack; explicit expired-token fixture     |
| `E2E-AUTH-06-current-membership-revocation`     | Removing the current Member in the owned database invalidates an existing session on recheck; protected UI returns to login.                                                                                           | Real stack; explicit membership change         |
| `E2E-AUTH-07-injected-logout-retry-and-repeat`  | Repeated logout clicks share the pending cleanup; one injected 503 keeps identity hidden; the actual Retry sign-out button completes real cleanup.                                                                     | Injected one-response failure and delay        |
| `E2E-AUTH-08-injected-interrupted-completion`   | Cancel during a held real NextAuth completion cancels the attempt; releasing the request does not restore authentication; final cleanup and protected reload remain anonymous.                                         | Injected request timing; actual auth endpoints |
| `E2E-AUTH-09-injected-session-error-retry`      | Injected session-read unavailability on reload hides identity; Check account again restores identity only after a successful real server read.                                                                         | Injected temporary read failure                |

Adjacent contracts and further races are covered in [`authController.test.ts`](../../src/hooks/authController.test.ts), [`authApi.test.ts`](../../src/api/auth/authApi.test.ts), and backend [`integration.test.ts`](../../../backend/tests/integration.test.ts) (`TEST-MM-008/009/025`) and [`http.test.ts`](../../../backend/tests/http.test.ts) (`TEST-MM-011/025/026`). Logout does not globally revoke previously copied JWTs; the suite does not claim that unsupported behavior.

### Meetings, pagination, content, and recovery

Implemented in [`meetings.browser.mjs`](meetings.browser.mjs) and [`authorization.browser.mjs`](authorization.browser.mjs).

| Scenario                                 | Requirement / observable assertion                                                                                                                                                       | Scope                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `E2E-LIST-01`                            | Date-filtered list requests the next server page, uses server totals, asserts exact ordered IDs without duplicates across the final partial page, and resets for an empty date.          | Real stack                                              |
| `E2E-MEMBER-01`                          | Member search loads 20, 40, then all 55 distinct seeded matches, removes the exhausted load-more control, replaces results for a new query, and adds/removes a selection.                | Real stack                                              |
| `E2E-CREATE-ONSITE`, `E2E-CREATE-ONLINE` | Required input validation; both meeting formats persist and survive reload; online links require HTTPS and retain their stored destination.                                              | Real stack                                              |
| `E2E-CREATE-RECOVERY`                    | A successful backend create whose response is lost is recovered without creating a second meeting.                                                                                       | Injected loss after a real commit                       |
| `E2E-EDIT-01`                            | Creator changes title/preparation details and replaces team membership, with database verification and persisted values after reload.                                                    | Real stack                                              |
| `E2E-CANCEL-01`                          | Dismissing cancellation preserves the meeting; confirming persists Cancelled status and updates available actions.                                                                       | Real stack                                              |
| `E2E-DELETE-01`                          | Dismissing deletion preserves the row; confirming deletes it, notes, and feedback, returns to the list, and prevents reading its old URL.                                                | Real stack                                              |
| `E2E-FEEDBACK-01`                        | Create and edit own feedback, prevent a second Add action, replay the original request key with 200 and one persisted author entry, and reload saved text.                               | Real stack                                              |
| `E2E-FEEDBACK-PAGES`                     | Load initial 50 and remaining older entries, retain unique IDs/order membership, stop at the final page, and retain own-entry edit access.                                               | Real stack                                              |
| `E2E-READ-RECOVERY`                      | A failed detail read offers retry and displays real data after transport recovery.                                                                                                       | Injected summary transport failure                      |
| `E2E-TIMEZONE-01`                        | A browser configured for Los Angeles still renders the stored schedule in the application’s Bangkok timezone.                                                                            | Real stack; alternate browser timezone                  |
| `E2E-NAVIGATION-01`                      | A held actual App Router response exercises loading during link navigation while preserving the header; Back/Forward navigation remains usable.                                          | Injected App Router response timing; real route content |
| `E2E-NOTES-01`                           | Own note text persists exactly; another signed-in author sees only their own private note; clearing one author’s note to empty survives reload without changing the other author’s note. | Real stack; separate browser actors                     |
| `E2E-NOTES-CONFLICT`                     | Two contexts for the same author cannot silently overwrite a newer note with a stale version.                                                                                            | Real stack; concurrent actors                           |
| `E2E-AUTHZ-01`                           | An attendee can read the allowed detail but lacks creator controls; forged edit/team/cancel/delete requests are rejected without database changes.                                       | Real stack                                              |
| `E2E-AUTHZ-02`                           | An outsider cannot read protected meeting/private note data.                                                                                                                             | Real stack                                              |
| `E2E-AUTHZ-NOTE-01`                      | Forged foreign-author note query/body input is rejected without changing saved notes.                                                                                                    | Real stack                                              |

The application supports feedback create/read/update, with removal when its meeting is deleted. It exposes no standalone feedback-delete action; the suite does not invent one to label the flow “CRUD.”

## Coverage limits to read with the matrix

A passing run covers the named interactions and fixtures, not every input, time instant, network ordering, or device. Relevant detailed regression coverage remains in:

- [`meeting-development.integration.test.ts`](../../../backend/tests/meeting-development.integration.test.ts): immutable schedule, atomic team/details changes, stale writes, date/list snapshots, access changes, deletion, and commit outcomes.
- [`notes-feedback.integration.test.ts`](../../../backend/tests/notes-feedback.integration.test.ts): note privacy, concurrent feedback keys, author ownership, older-page snapshots, access changes while waiting for locks, and content rollback/cascade behavior.
- [`pagination.test.ts`](../../../backend/tests/pagination.test.ts): strict pagination/snapshot validation.
- [`MeetingDetail.test.tsx`](<../../src/app/(main)/meetings/[meetingId]/_components/MeetingDetail.test.tsx>) and related hook tests: precise meeting-end timer boundaries and rerender behavior.

Full temporal boundary combinations, every pagination input/snapshot mutation, real Google OAuth, physical iOS Safari, accessibility beyond the exercised keyboard/focus paths, and measured frame rate/production latency are not established by the core browser scenarios above. Record added scenarios and their scope in this matrix as coverage grows; do not convert unexecuted or unavailable-browser coverage into a PASS claim.
