export const SUITES = Object.freeze(["auth", "meetings", "authorization"]);
export const EXPECTED_COUNTS = Object.freeze({ full: 27, critical: 8 });
const caseId = /^E2E-[A-Za-z0-9_-]+$/;

function uniqueIds(ids, label) {
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string" || !caseId.test(id))
  )
    throw new Error(`${label} must contain exact scenario IDs`);
  if (new Set(ids).size !== ids.length)
    throw new Error(`${label} contains duplicate scenario IDs`);
}
export function readSelectionRequest(env = {}) {
  const profile = env.E2E_PROFILE ?? "full";
  if (!["critical", "full"].includes(profile))
    throw new Error("E2E_PROFILE must be critical or full");
  const suite = env.E2E_SUITE;
  const selectedCase = env.E2E_CASE;
  if (suite !== undefined && !SUITES.includes(suite))
    throw new Error("E2E_SUITE must be auth, meetings, or authorization");
  if (selectedCase !== undefined && (!suite || !caseId.test(selectedCase)))
    throw new Error(
      "E2E_CASE must be an exact scenario ID and requires E2E_SUITE",
    );
  return { profile, suite, selectedCase };
}
export function validateCases(cases) {
  if (!Array.isArray(cases) || !cases.length)
    throw new Error("Scenario inventory is empty");
  uniqueIds(
    cases.map((entry) => entry.id),
    "Scenario inventory",
  );
  for (const entry of cases) {
    if (!SUITES.includes(entry.suite))
      throw new Error("Unknown scenario suite");
    if (
      !Array.isArray(entry.tags) ||
      entry.tags.some((tag) => tag !== "@critical") ||
      new Set(entry.tags).size !== entry.tags.length
    )
      throw new Error(`Unknown or duplicate tags for ${entry.id}`);
  }
}
export async function collectCases(suite, define) {
  const cases = [];
  await define({
    run: async (
      id,
      scenario,
      options = {},
      scope = "real local frontend/backend/PostgreSQL",
    ) => {
      if (typeof scenario !== "function")
        throw new Error("Scenario must be a function");
      const { tags = [], ...contextOptions } = options;
      cases.push({ id, suite, tags, scenario, contextOptions, scope });
    },
  });
  validateCases(cases);
  return cases;
}
export function metadata(cases) {
  return cases.map(({ id, suite, tags }) => ({ id, suite, tags }));
}
export function selectCases(cases, request) {
  validateCases(cases);
  const critical = cases.filter((entry) => entry.tags.includes("@critical"));
  if (
    cases.length !== EXPECTED_COUNTS.full ||
    critical.length !== EXPECTED_COUNTS.critical
  )
    throw new Error(
      `Scenario inventory must contain ${EXPECTED_COUNTS.full} cases with ${EXPECTED_COUNTS.critical} @critical tags`,
    );
  if (
    request.selectedCase &&
    !cases.some(
      (entry) =>
        entry.id === request.selectedCase && entry.suite === request.suite,
    )
  )
    throw new Error(
      `Unknown E2E_CASE in selected suite: ${request.selectedCase}`,
    );
  const selected = (request.profile === "critical" ? critical : cases).filter(
    (entry) =>
      (!request.suite || entry.suite === request.suite) &&
      (!request.selectedCase || entry.id === request.selectedCase),
  );
  if (!selected.length) throw new Error("E2E selection matched zero scenarios");
  return selected;
}
export function selectRegisteredCases(cases, ids) {
  validateCases(cases);
  uniqueIds(ids, "Selected cases");
  if (!ids.length) throw new Error("Selected cases must not be empty");
  const selected = cases.filter((entry) => ids.includes(entry.id));
  if (selected.length !== ids.length)
    throw new Error("Selected cases are missing from the registered suite");
  return selected;
}
export function summarizeResults(results, expectedIds) {
  uniqueIds(expectedIds, "Expected results");
  if (!expectedIds.length || !Array.isArray(results))
    throw new Error("Invalid expected scenario results");
  uniqueIds(
    results.map((result) => result.id),
    "Scenario results",
  );
  for (const result of results)
    if (
      !expectedIds.includes(result.id) ||
      !["PASS", "FAIL"].includes(result.status)
    )
      throw new Error("Unexpected scenario result or status");
  return {
    completed: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    failed: results.filter((result) => result.status === "FAIL").length,
    missing: expectedIds.filter(
      (id) => !results.some((result) => result.id === id),
    ),
  };
}
