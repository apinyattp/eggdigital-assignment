// Isolated test process only: redirect provider HTTP to the controlled OIDC fixture.
// Production NextAuth configuration and OAuth cryptography remain unchanged.
import https from "node:https";
import http from "node:http";
const original = https.request;
https.request = function (input, options, callback) {
  const url = new URL(input);
  if (
    process.env.OIDC_TEST_STUB_ORIGIN &&
    [
      "accounts.google.com",
      "oauth2.googleapis.com",
      "www.googleapis.com",
    ].includes(url.hostname)
  ) {
    const target = new URL(
      `/provider${url.pathname}${url.search}`,
      process.env.OIDC_TEST_STUB_ORIGIN,
    );
    return http.request(target, options, callback);
  }
  return original.apply(this, arguments);
};
