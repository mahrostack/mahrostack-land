/**
 * Smoke-check key API routes used by QabasGo.
 * Usage: node scripts/api-smoke.mjs [baseUrl]
 * Default baseUrl: https://api.qabas.one/api/v1
 */
const base = (process.argv[2] ?? "https://api.qabas.one/api/v1").replace(/\/$/, "");
const docsBase = base.replace(/\/api\/v1$/, "/api");

const checks = [
  { name: "OpenAPI spec", method: "GET", url: `${docsBase}/docs/openapi.json`, expect: [200] },
  { name: "Auth login (empty body)", method: "POST", url: `${base}/auth/login`, body: {}, expect: [400, 422] },
  { name: "Driver report (auth required)", method: "GET", url: `${base}/reports/driver`, expect: [401] },
  { name: "Current driver day (auth required)", method: "GET", url: `${base}/driver-days/current`, expect: [401, 404] },
  { name: "Driver app today (auth required)", method: "GET", url: `${base}/driver-app/today`, expect: [401] },
  { name: "Parties list (auth required)", method: "GET", url: `${base}/parties`, expect: [401] },
  { name: "Products catalog (auth required)", method: "GET", url: `${base}/catalog/products`, expect: [401] },
  { name: "My warehouses (auth required)", method: "GET", url: `${base}/driver-days/my-warehouses`, expect: [401] },
  { name: "Open driver day (auth required)", method: "POST", url: `${base}/driver-days/open`, body: {}, expect: [400, 401, 422] },
];

let failed = 0;

for (const check of checks) {
  const init = { method: check.method, headers: { Accept: "application/json" } };
  if (check.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(check.body);
  }

  let status;
  try {
    const res = await fetch(check.url, init);
    status = res.status;
  } catch (error) {
    console.error(`FAIL ${check.name}: network error — ${error.message}`);
    failed++;
    continue;
  }

  const ok = check.expect.includes(status);
  console.log(`${ok ? "PASS" : "FAIL"} ${check.name}: HTTP ${status}`);
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll API smoke checks passed.");
