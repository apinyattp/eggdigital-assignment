// Actual NextAuth route/OAuth checks with controlled provider + B1. NOT real Google or Express evidence.
import { createServer } from "node:http";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
let origin;
const checks = [];
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "synthetic-test-key",
  use: "sig",
  alg: "RS256",
};
const codes = new Map();
let issuerCalls = 0;
let tokenCalls = 0;
let issuerGate;
let child;
let browser;
let runtimeDiagnostics = "";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push({ name, status: "PASS" });
};
async function waitFor(predicate) {
  const end = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > end)
      throw new Error("Controlled callback did not reach expected stage");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function idToken(nonce) {
  const payload = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({ iss: "https://accounts.google.com", aud: "synthetic-client", sub: "synthetic-google-user", email: "synthetic@example.test", email_verified: true, name: "Synthetic Google", nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120 })}`;
  return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
}
const fixture = createServer(async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.url === "/provider/.well-known/openid-configuration")
    return json(200, {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
    });
  if (req.url === "/provider/oauth2/v3/certs")
    return json(200, { keys: [jwk] });
  if (req.url === "/provider/token") {
    tokenCalls++;
    const form = new URLSearchParams(body);
    const code = codes.get(form.get("code"));
    if (
      !code ||
      createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url") !== code.challenge
    )
      return json(400, { error: "invalid_grant" });
    if (code.gate) await code.gate.promise;
    return json(200, {
      access_token: "synthetic-provider-access",
      token_type: "Bearer",
      expires_in: 120,
      id_token: idToken(code.wrongNonce ? "wrong-nonce" : code.nonce),
    });
  }
  if (req.url === "/api/v1/auth/session") {
    const access = req.headers.cookie;
    if (
      ![
        "mm_access=synthetic.google.signature",
        "mm_access=synthetic.password.signature",
      ].includes(access)
    )
      return json(401, { error: { code: "UNAUTHENTICATED" } });
    return json(200, {
      user: { id: "synthetic-member", membership: "member" },
    });
  }
  if (req.url === "/internal/auth/issue") {
    issuerCalls++;
    if (
      req.headers["x-auth-service-key"] !==
      "synthetic-service-caller-key-for-library-tests"
    )
      return json(401, { error: { code: "UNAUTHENTICATED" } });
    const input = JSON.parse(body);
    if (input.method === "google" && issuerGate) await issuerGate.promise;
    return json(200, {
      accessToken: `synthetic.${input.method}.signature`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id:
          input.method === "google"
            ? "synthetic-google-member"
            : "synthetic-member",
        displayName: "Synthetic",
        email: "synthetic@example.test",
        membership: "member",
      },
    });
  }
  json(404, {});
});
const headers = { "X-Requested-With": "MeetingManager" };
async function csrf(context) {
  return (await (await context.request.get(`${origin}/api/auth/csrf`)).json())
    .csrfToken;
}
async function begin(context, options = {}) {
  assert.equal(
    (
      await context.request.post(`${origin}/api/auth/attempt`, {
        headers,
        data: { action: "start" },
      })
    ).status(),
    200,
  );
  const response = await context.request.post(
    `${origin}/api/auth/signin/google`,
    {
      form: {
        csrfToken: await csrf(context),
        callbackUrl: "/login?complete=1",
        json: "true",
      },
    },
  );
  assert.equal(response.status(), 200);
  const url = new URL((await response.json()).url);
  const code = `synthetic-code-${codes.size}`;
  codes.set(code, {
    nonce: url.searchParams.get("nonce"),
    challenge: url.searchParams.get("code_challenge"),
    ...options,
  });
  return { state: url.searchParams.get("state"), code };
}
const callback = (context, tx) =>
  context.request.get(
    `${origin}/api/auth/callback/google?state=${encodeURIComponent(tx.state)}&code=${tx.code}`,
    { maxRedirects: 0 },
  );
async function cancel(context) {
  await context.request.post(`${origin}/api/auth/attempt`, {
    headers,
    data: { action: "cancel" },
  });
  await context.request.post(`${origin}/api/auth/signout`, {
    form: {
      csrfToken: await csrf(context),
      callbackUrl: "/login",
      json: "true",
    },
  });
}
async function passwordB(context) {
  await context.request.post(`${origin}/api/auth/attempt`, {
    headers,
    data: { action: "start" },
  });
  const response = await context.request.post(
    `${origin}/api/auth/callback/credentials`,
    {
      form: {
        csrfToken: await csrf(context),
        email: "synthetic@example.test",
        password: "synthetic-password",
        callbackUrl: "/login?complete=1",
        json: "true",
      },
    },
  );
  assert.equal(response.status(), 200);
  assert.equal(
    (
      await context.request.post(`${origin}/api/auth/complete`, {
        headers,
        data: {},
      })
    ).status(),
    200,
  );
}
try {
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const stub = `http://127.0.0.1:${fixture.address().port}`;
  const lease = createServer();
  lease.listen(0, "127.0.0.1");
  await once(lease, "listening");
  const port = lease.address().port;
  await new Promise((resolve) => lease.close(resolve));
  origin = `http://localhost:${port}`;
  headers.origin = origin;
  child = spawn(
    process.execPath,
    [
      "--import",
      path.join(root, "tests/oidc-preload.mjs"),
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXTAUTH_URL: origin,
        NEXTAUTH_SECRET: "synthetic-next-secret-for-library-tests",
        AUTH_SERVICE_KEY: "synthetic-service-caller-key-for-library-tests",
        AUTH_BACKEND_INTERNAL_URL: stub,
        COOKIE_SECURE: "false",
        GOOGLE_CLIENT_ID: "synthetic-client",
        GOOGLE_CLIENT_SECRET: "synthetic-provider-secret",
        OIDC_TEST_STUB_ORIGIN: stub,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      runtimeDiagnostics += chunk.toString();
    });
  let ready = false;
  let probe = "not attempted";
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/auth/providers`,
      );
      ready = response.ok;
      probe = `HTTP ${response.status}`;
    } catch (error) {
      probe = String(error);
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, `Isolated library server ready: ${probe}`);
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : { channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" }),
    headless: true,
  });
  {
    const context = await browser.newContext();
    const tx = await begin(context);
    const before = issuerCalls;
    const response = await callback(context, tx);
    check(
      "actual_library_valid_state_PKCE_nonce_to_mock_B1",
      response.status() === 302 &&
        response.headers().location === `${origin}/login?complete=1` &&
        issuerCalls === before + 1,
    );
    const complete = await context.request.post(`${origin}/api/auth/complete`, {
      headers,
      data: {},
    });
    check(
      "Google_exact_mock_issuer_token_completion",
      complete.status() === 200 &&
        (await context.cookies()).find((c) => c.name === "mm_access")?.value ===
          "synthetic.google.signature",
    );
    const session = await (
      await context.request.get(`${origin}/api/auth/session`)
    ).json();
    check(
      "session_read_no_reissue_no_token_JSON",
      issuerCalls === before + 1 &&
        Object.keys(session).join(",") === "expires",
    );
    await cancel(context);
    check(
      "acknowledged_cancel_and_signout_remove_session_and_access_cookies",
      !(await context.cookies()).some(
        (c) => c.name === "mm_access" || c.name.includes("session-token"),
      ),
    );
    check(
      "session_stays_anonymous_after_acknowledged_signout",
      Object.keys(
        await (await context.request.get(`${origin}/api/auth/session`)).json(),
      ).length === 0,
    );
    await context.close();
  }
  for (const invalid of [
    "state",
    "pkce.code_verifier",
    "nonce",
    "id_token_nonce",
  ]) {
    const context = await browser.newContext();
    const tx = await begin(context, {
      wrongNonce: invalid === "id_token_nonce",
    });
    const before = issuerCalls;
    if (invalid !== "id_token_nonce")
      await context.clearCookies({ name: `next-auth.${invalid}` });
    const response = await callback(context, tx);
    check(
      `actual_library_invalid_${invalid}_rejects_before_B1`,
      response.status() >= 300 &&
        response.status() < 400 &&
        issuerCalls === before &&
        !(await context.cookies()).some(
          (c) => c.name === "mm_access" || c.name.includes("session-token"),
        ),
    );
    await context.close();
  }
  for (const stage of ["library_token_await", "B1_await"]) {
    const context = await browser.newContext();
    const gate = deferred();
    if (stage === "B1_await") issuerGate = gate;
    const tx = await begin(
      context,
      stage === "library_token_await" ? { gate } : {},
    );
    const before = issuerCalls;
    const tokenBefore = tokenCalls;
    const pending = callback(context, tx);
    await waitFor(() =>
      stage === "B1_await" ? issuerCalls > before : tokenCalls > tokenBefore,
    );
    await cancel(context);
    await passwordB(context);
    const bCookies = JSON.stringify(
      (await context.cookies()).sort((a, b) => a.name.localeCompare(b.name)),
    );
    gate.resolve();
    const stale = await pending;
    issuerGate = undefined;
    check(
      `replacement_during_${stage}_suppresses_all_stale_cookies`,
      !stale.headers()["set-cookie"] &&
        JSON.stringify(
          (await context.cookies()).sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        ) === bCookies,
    );
    check(
      `replacement_during_${stage}_preserves_B_and_issuer_count`,
      (await context.cookies()).find((c) => c.name === "mm_access")?.value ===
        "synthetic.password.signature" &&
        issuerCalls === before + (stage === "B1_await" ? 2 : 1),
    );
    await context.close();
  }
  console.log(
    JSON.stringify({
      passed: checks.length,
      checks,
      boundary:
        "Actual installed NextAuth with synthetic OIDC and B1; not live Google/Express",
    }),
  );
} catch (error) {
  checks.push({
    name: error instanceof Error ? error.message : "Controlled library failure",
    status: "FAIL",
  });
  process.exitCode = 1;
  console.error("Controlled library check failed; inspect test evidence");
} finally {
  if (browser) await browser.close();
  if (child) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  await new Promise((resolve) => fixture.close(resolve));
  if (process.env.FE_EVIDENCE_DIR) {
    await fs.mkdir(process.env.FE_EVIDENCE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(process.env.FE_EVIDENCE_DIR, "controlled-library.json"),
      JSON.stringify(
        {
          checks,
          liveGoogle: "NOT_RUN",
          boundary:
            "Actual NextAuth cryptographic checks with controlled synthetic provider and B1. No production test hooks.",
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(process.env.FE_EVIDENCE_DIR, "controlled-runtime.log"),
      runtimeDiagnostics,
    );
  }
}
