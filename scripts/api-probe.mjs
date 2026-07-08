/**
 * Probe QabasGo API routes with real credentials and capture exact response shapes.
 *
 * Usage:
 *   node scripts/api-probe.mjs [baseUrl]
 *   API_PROBE_IDENTIFIER=01015003347 API_PROBE_PASSWORD=secret node scripts/api-probe.mjs
 *   API_PROBE_IDENTIFIER_2=driver2 API_PROBE_PASSWORD_2=secret node scripts/api-probe.mjs
 *
 * Default baseUrl: https://api.qabas.one/api/v1
 * Default identifier/password: 01015003347 / password
 *
 * Writes: scripts/api-probe-report.json
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const base = (process.argv[2] ?? process.env.VITE_API_BASE_URL ?? "https://api.qabas.one/api/v1").replace(/\/$/, "");
const identifier = process.env.API_PROBE_IDENTIFIER ?? "01015003347";
const password = process.env.API_PROBE_PASSWORD ?? "password";

const report = {
  probedAt: new Date().toISOString(),
  baseUrl: base,
  identifier,
  login: null,
  routes: [],
  summary: [],
};

function redact(value, depth = 0) {
  if (depth > 8) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 80 && /^eyJ/.test(value)) return `[jwt:${value.length}chars]`;
    if (value.length > 200) return `${value.slice(0, 80)}…[${value.length}chars]`;
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const sample = value.slice(0, 2).map((item) => redact(item, depth + 1));
    return value.length > 2 ? [...sample, `…+${value.length - 2} more`] : sample;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/token|password|secret|authorization/i.test(k)) {
      out[k] = typeof v === "string" ? `[redacted:${v.length}chars]` : "[redacted]";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array<empty>";
    const itemTypes = [...new Set(value.slice(0, 5).map((v) => describeType(v)))];
    return `array<${itemTypes.join(" | ")}>`;
  }
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value);
  const nested = {};
  for (const key of keys.slice(0, 20)) {
    nested[key] = describeType(value[key]);
  }
  if (keys.length > 20) nested["…"] = `+${keys.length - 20} keys`;
  return nested;
}

function analyzeBody(body) {
  const hasEnvelope = body && typeof body === "object" && body.success === true && "data" in body;
  const hasErrorEnvelope = body && typeof body === "object" && body.success === false && "error" in body;
  const payload = hasEnvelope ? body.data : body;
  const pagination = hasEnvelope ? body.pagination : undefined;

  let listShape = null;
  if (Array.isArray(payload)) {
    listShape = { kind: "array", length: payload.length, itemKeys: payload[0] ? Object.keys(payload[0]) : [] };
  } else if (payload && typeof payload === "object" && Array.isArray(payload.items)) {
    listShape = {
      kind: "paginated.items",
      length: payload.items.length,
      itemKeys: payload.items[0] ? Object.keys(payload.items[0]) : [],
      wrapperKeys: Object.keys(payload),
    };
  }

  return {
    responseStyle: hasEnvelope ? "envelope { success, data }" : hasErrorEnvelope ? "error envelope" : "direct payload",
    topLevelKeys: body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null,
    payloadType: describeType(payload),
    payloadKeys:
      payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : null,
    listShape,
    pagination: pagination ?? (body?.pagination ? body.pagination : null),
    appExpectationGap: inferGap(hasEnvelope, payload, listShape),
  };
}

function inferGap(hasEnvelope, payload, listShape) {
  const gaps = [];
  if (!hasEnvelope) gaps.push("App unwrap() supports direct payloads — OK if tokens/user at top level");
  else gaps.push("Uses { success, data } envelope");

  if (Array.isArray(payload)) {
    gaps.push("Payload is a bare array — ensure unwrapPaginated handles this");
  }
  if (listShape?.kind === "paginated.items") {
    gaps.push("Payload uses { items: [] } not { data: [] } — check list parsers");
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if ("id" in payload && !("_id" in payload)) gaps.push("Uses `id` not `_id` — mappers must map id → _id");
    if ("firstName" in payload && !("fName" in payload)) gaps.push("Uses firstName/lastName not fName/lName");
  }
  if (listShape?.itemKeys?.length) {
    if (listShape.itemKeys.includes("id") && !listShape.itemKeys.includes("_id")) {
      gaps.push("List items use `id` not `_id`");
    }
  }
  return gaps;
}

async function request(method, path, { token, body, label } = {}) {
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { Accept: "application/json", "Accept-Language": "ar" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  let status;
  let raw;
  let parseError = null;

  try {
    const res = await fetch(url, init);
    status = res.status;
    const text = await res.text();
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = text;
      parseError = "non-json response";
    }
  } catch (error) {
    return {
      label: label ?? `${method} ${path}`,
      method,
      path,
      ok: false,
      networkError: error.message,
    };
  }

  const analysis = typeof raw === "object" ? analyzeBody(raw) : { responseStyle: "non-object", payloadType: typeof raw };

  const entry = {
    label: label ?? `${method} ${path}`,
    method,
    path,
    status,
    ok: status >= 200 && status < 300,
    analysis,
    body: redact(raw),
    rawSample: typeof raw === "object" ? redact(raw) : raw,
  };

  if (parseError) entry.parseError = parseError;
  report.routes.push(entry);

  const flag = entry.ok ? "OK" : "FAIL";
  console.log(`${flag} ${entry.label} → HTTP ${status} | ${analysis.responseStyle}`);
  if (analysis.appExpectationGap?.length) {
    for (const gap of analysis.appExpectationGap) console.log(`     ↳ ${gap}`);
  }

  return { entry, raw, status };
}

function extractTokens(loginBody) {
  if (!loginBody || typeof loginBody !== "object") return null;
  if (loginBody.success === true && loginBody.data) return loginBody.data;
  if (loginBody.accessToken) return loginBody;
  return null;
}

async function main() {
  console.log(`\nQabasGo API probe`);
  console.log(`Base: ${base}`);
  console.log(`User: ${identifier}\n`);

  const loginRes = await request("POST", "/auth/login", {
    label: "POST /auth/login",
    body: { identifier, password },
  });

  report.login = {
    status: loginRes.status,
    analysis: loginRes.entry?.analysis,
    body: loginRes.entry?.body,
  };

  const tokens = extractTokens(loginRes.raw);
  if (!tokens?.accessToken) {
    console.error("\nLogin failed — cannot probe authenticated routes.");
    writeReport();
    process.exit(1);
  }

  const token = tokens.accessToken;
  const refreshToken = tokens.refreshToken;

  await request("GET", "/me", { token, label: "GET /me" });
  await request("GET", "/driver-days/current", { token, label: "GET /driver-days/current" });
  await request("GET", "/driver-days/my-warehouses", { token, label: "GET /driver-days/my-warehouses" });
  await request("GET", "/driver-days?limit=5&sortOrder=desc&status=CLOSED", {
    token,
    label: "GET /driver-days (history)",
  });
  await request("GET", "/driver-app/today", { token, label: "GET /driver-app/today" });
  await request("GET", "/reports/driver", { token, label: "GET /reports/driver" });
  const productsRes = await request("GET", "/catalog/products?isActive=true&limit=10", {
    token,
    label: "GET /catalog/products",
  });
  const catalogProducts = extractList(productsRes.raw);
  const sampleCatalogProduct =
    catalogProducts.find((p) => p.baseUnitId) ?? catalogProducts[0] ?? null;

  const unitsRes = await request("GET", "/catalog/units?isActive=true&limit=50", {
    token,
    label: "GET /catalog/units",
  });
  const catalogUnits = extractList(unitsRes.raw);
  const kgCatalogUnit =
    catalogUnits.find((u) => String(u.code ?? "").toUpperCase() === "KG") ??
    catalogUnits.find((u) => String(u.name ?? "").includes("كيلو")) ??
    null;
  const bagCatalogUnit =
    catalogUnits.find((u) => String(u.code ?? "").toUpperCase() === "BAG") ?? null;

  if (sampleCatalogProduct) {
    const productId = sampleCatalogProduct.id ?? sampleCatalogProduct._id;
    await request("GET", `/catalog/unit-conversions?productId=${productId}&isActive=true&limit=20`, {
      token,
      label: "GET /catalog/unit-conversions",
    });
    report.summary.push(
      `Catalog units: ${catalogUnits.length} unit(s); KG=${kgCatalogUnit?.id ?? "missing"}; sample product=${productId}`
    );
  } else {
    report.summary.push("Skipped unit-conversions probe — no catalog products");
  }
  await request("GET", "/parties?limit=10", { token, label: "GET /parties" });
  const expenseTypesRes = await request("GET", "/driver-settings/expense-types", {
    token,
    label: "GET /driver-settings/expense-types",
  });
  const expenseTypes = extractExpenseTypesList(expenseTypesRes.raw);
  report.expenseTypes = {
    count: expenseTypes.length,
    sampleKeys: expenseTypes[0] ? Object.keys(expenseTypes[0]) : [],
    samples: expenseTypes.slice(0, 5).map((t) => ({
      code: t.code,
      nameAr: t.nameAr ?? t.name ?? null,
      requiresReceipt: t.requiresReceipt,
      requiresNote: t.requiresNote,
      isActive: t.isActive,
    })),
  };
  if (expenseTypes.length === 0) {
    report.summary.push(
      "EXPENSE TYPES EMPTY: GET /driver-settings/expense-types returned no items — seed active types (FUEL, MAINTENANCE, TOLL, OTHER) for drivers"
    );
  } else {
    report.summary.push(
      `Expense types OK: ${expenseTypes.length} type(s); codes=${expenseTypes.map((t) => t.code).join(", ")}`
    );
  }
  await request("GET", "/me/avatar/url", { token, label: "GET /me/avatar/url" });

  report.summary.push(
    "POST /me/avatar: multipart field must be `image` (not `avatar`); JPEG only; do not set Content-Type manually"
  );

  if (refreshToken) {
    await request("POST", "/auth/refresh", {
      label: "POST /auth/refresh",
      body: { refreshToken },
    });
  }

  const current = report.routes.find((r) => r.path === "/driver-days/current" && r.ok);
  const currentDay = current?.analysis?.responseStyle?.includes("envelope")
    ? report.routes.find((r) => r.path === "/driver-days/current")?.body?.data
    : report.routes.find((r) => r.path === "/driver-days/current")?.body;

  const dayId =
    currentDay?.id ??
    currentDay?.data?.id ??
    (typeof currentDay === "object" && currentDay !== null ? currentDay.id : null);

  if (dayId) {
    const opsRes = await request("GET", `/driver-days/${dayId}/operations`, {
      token,
      label: `GET /driver-days/${dayId}/operations`,
    });
    const ops = extractList(opsRes.raw);
    if (ops.length > 0) {
      const byType = {};
      for (const op of ops) {
        const t = String(op.type ?? "UNKNOWN").toUpperCase();
        if (!byType[t]) byType[t] = op;
      }
      for (const [type, sample] of Object.entries(byType)) {
        const keys = Object.keys(sample);
        const metaKeys = sample.metadata && typeof sample.metadata === "object" ? Object.keys(sample.metadata) : [];
        report.summary.push(
          `Operation sample [${type}]: top-level keys=${keys.join(",")}; metadata keys=${metaKeys.join(",") || "none"}`
        );
        if (sample.metadata?.expenses) {
          report.summary.push(`  ${type} metadata.expenses: ${JSON.stringify(sample.metadata.expenses).slice(0, 200)}`);
        }
        if (sample.metadata?.payments) {
          report.summary.push(`  ${type} metadata.payments: ${JSON.stringify(sample.metadata.payments).slice(0, 200)}`);
        }
        if (sample.metadata?.unit || sample.metadata?.quantityUnit || sample.unitId) {
          report.summary.push(
            `  ${type} unit fields: unit=${sample.metadata?.unit ?? "—"}, quantityUnit=${sample.metadata?.quantityUnit ?? "—"}, unitId=${sample.unitId ?? "—"}`
          );
        }
      }
    } else {
      report.summary.push("GET /driver-days/:id/operations returned empty list — mapper uses metadata fallbacks for trade extras");
    }

    const partiesRes = await request("GET", "/parties?limit=1", {
      token,
      label: "GET /parties (for receipt probe)",
    });
    const parties = extractList(partiesRes.raw);
    const samplePartyId = parties[0]?.id ?? parties[0]?._id ?? null;

    const probeDate = new Date().toISOString().slice(0, 10);
    const cashboxesRes = await request("GET", "/treasury/cashboxes?isActive=true&limit=5", {
      token,
      label: "GET /treasury/cashboxes (for receipt probe)",
    });
    const cashboxes = extractList(cashboxesRes.raw);
    const cashboxId = cashboxes.find((b) => b.isMain)?.id ?? cashboxes[0]?.id ?? null;

    const receiptPayloads = [
      { label: "amount + date", body: { amount: 1, date: probeDate, description: "api-probe receipt" } },
      ...(cashboxId
        ? [
            {
              label: "treasury shape (CASHBOX + OTHER_INCOME)",
              body: {
                amount: 1,
                date: probeDate,
                destinationType: "CASHBOX",
                cashboxId,
                purpose: "OTHER_INCOME",
                description: "api-probe treasury receipt",
              },
            },
          ]
        : []),
      ...(samplePartyId && cashboxId
        ? [
            {
              label: "treasury shape + partyId",
              body: {
                amount: 1,
                date: probeDate,
                destinationType: "CASHBOX",
                cashboxId,
                purpose: "CUSTOMER_COLLECTION",
                partyId: samplePartyId,
                description: "api-probe",
              },
            },
          ]
        : []),
    ];

    for (const probe of receiptPayloads) {
      await request("POST", `/driver-app/days/${dayId}/receipts`, {
        token,
        label: `POST /driver-app/days/{dayId}/receipts (${probe.label})`,
        body: probe.body,
      });
    }

    report.summary.push(
      "Receipt create: POST /driver-app/days/{dayId}/receipts requires treasury fields (destinationType, cashboxId, purpose; counterAccountId when party)"
    );

    const expenseTypesRes = await request("GET", "/driver-settings/expense-types", {
      token,
      label: "GET /driver-settings/expense-types (expense probe)",
    });
    const expenseTypes = extractList(expenseTypesRes.raw);
    const fuelType = expenseTypes.find((t) => t.code === "FUEL") ?? expenseTypes[0];

    if (fuelType) {
      await request("POST", `/driver-app/days/${dayId}/expenses`, {
        token,
        label: "POST /driver-app/days/{dayId}/expenses (operational)",
        body: {
          amount: 1,
          date: probeDate,
          expenseTypeCode: fuelType.code,
          notes: "api-probe expense",
          hasAttachment: false,
        },
      });
      report.summary.push(
        "Expense create: POST /driver-app/days/{dayId}/expenses resolves accountId from chart via expenseTypeCode"
      );
    } else {
      report.summary.push(
        "Skipped POST expenses probe — no active expense types returned from /driver-settings/expense-types"
      );
    }

    if (samplePartyId && cashboxId) {
      await request("POST", `/driver-app/days/${dayId}/payments`, {
        token,
        label: "POST /driver-app/days/{dayId}/payments (party payment)",
        body: {
          amount: 1,
          date: probeDate,
          sourceType: "CASHBOX",
          cashboxId,
          purpose: "SUPPLIER_PAYMENT",
          partyId: samplePartyId,
          description: "api-probe payment",
        },
      });
      report.summary.push(
        "Payment create: POST /driver-app/days/{dayId}/payments expects sourceType CASHBOX, cashboxId, purpose, partyId"
      );
    }

    if (
      sampleCatalogProduct &&
      samplePartyId &&
      kgCatalogUnit &&
      (bagCatalogUnit || sampleCatalogProduct.baseUnitId)
    ) {
      const productId = sampleCatalogProduct.id ?? sampleCatalogProduct._id;
      const quantityUnitId = kgCatalogUnit.id ?? kgCatalogUnit._id;
      const pricingUnitId =
        bagCatalogUnit?.id ??
        bagCatalogUnit?._id ??
        sampleCatalogProduct.baseUnitId;

      await request("POST", `/driver-app/days/${dayId}/purchases`, {
        token,
        label: "POST /driver-app/days/{dayId}/purchases (date + KG quantityUnit + pricingUnit)",
        body: {
          date: probeDate,
          supplierPartyId: samplePartyId,
          description: "api-probe purchase",
          lines: [
            {
              productId,
              quantity: 1,
              quantityUnitId,
              pricingUnitId,
              unitPrice: 1,
              description: "api-probe line",
            },
          ],
        },
      });
      report.summary.push(
        "Purchase create: POST /driver-app/days/{dayId}/purchases requires date + lines[] with separate quantityUnitId (KG) and pricingUnitId"
      );
    } else {
      report.summary.push(
        "Skipped POST purchases probe — need open day, product with baseUnitId, party, and KG unit in catalog"
      );
    }
  } else {
    report.summary.push("Skipped GET /driver-days/:id/operations — no open driver day (404 or null)");
    console.log("SKIP GET /driver-days/:id/operations — no open day");
  }

  const warehousesRes = report.routes.find((r) => r.path === "/driver-days/my-warehouses");
  const warehouses = extractList(warehousesRes?.body);
  if (warehouses.length > 0) {
    report.summary.push(`Found ${warehouses.length} warehouse(s); first id: ${warehouses[0].id ?? warehouses[0]._id}`);
  }
  report.summary.push(
    "Driver app: GET /driver-days/my-warehouses should return the driver's assigned warehouse; open-day uses resolveDefaultWarehouse (no picker)"
  );

  buildSummary();
  await probeDriverIsolation();
  writeReport();

  console.log(`\nReport written to scripts/api-probe-report.json`);
  console.log(`\n--- Summary ---`);
  for (const line of report.summary) console.log(`• ${line}`);
}

function extractList(body) {
  if (!body) return [];
  const payload = body.success === true ? body.data : body;
  if (Array.isArray(payload)) return payload;
  if (payload?.items && Array.isArray(payload.items)) return payload.items;
  return [];
}

function extractExpenseTypesList(body) {
  if (!body) return [];
  const payload = body.success === true ? body.data : body;
  if (Array.isArray(payload)) return payload;
  if (payload?.items && Array.isArray(payload.items)) return payload.items;
  if (payload?.expenseTypes && Array.isArray(payload.expenseTypes)) return payload.expenseTypes;
  return [];
}

function extractMeIdentity(raw) {
  const payload = raw?.success === true ? raw.data : raw;
  const user = payload?.user ?? payload;
  const party = payload?.party;
  return {
    userId: user?.id ?? user?._id ?? null,
    partyId: party?.id ?? user?.partyId ?? null,
    phone: user?.phone ?? party?.phone ?? null,
  };
}

function extractDayIdentity(raw) {
  const payload = raw?.success === true ? raw.data : raw;
  if (!payload || typeof payload !== "object") return null;
  return {
    id: payload.id ?? null,
    driverUserId: payload.driverUserId ?? null,
    driverPartyId: payload.driverPartyId ?? null,
    status: payload.status ?? null,
  };
}

async function loginDriver(driverIdentifier, driverPassword) {
  const loginRes = await request("POST", "/auth/login", {
    label: `POST /auth/login (${driverIdentifier})`,
    body: { identifier: driverIdentifier, password: driverPassword },
  });
  const tokens = extractTokens(loginRes.raw);
  if (!tokens?.accessToken) {
    return { ok: false, identifier: driverIdentifier, error: `login failed HTTP ${loginRes.status}` };
  }

  const token = tokens.accessToken;
  const meRes = await request("GET", "/me", { token, label: `GET /me (${driverIdentifier})` });
  const currentRes = await request("GET", "/driver-days/current", {
    token,
    label: `GET /driver-days/current (${driverIdentifier})`,
  });
  const listRes = await request("GET", "/driver-days?limit=5&sortOrder=desc", {
    token,
    label: `GET /driver-days (${driverIdentifier})`,
  });

  const me = extractMeIdentity(meRes.raw);
  const currentDay = extractDayIdentity(currentRes.raw);
  const dayList = extractList(listRes.raw).map((day) => ({
    id: day.id ?? null,
    driverUserId: day.driverUserId ?? null,
    driverPartyId: day.driverPartyId ?? null,
    status: day.status ?? null,
  }));

  let operationIds = [];
  const probeDayId = currentDay?.id ?? dayList[0]?.id ?? null;
  if (probeDayId) {
    const opsRes = await request("GET", `/driver-days/${probeDayId}/operations`, {
      token,
      label: `GET /driver-days/${probeDayId}/operations (${driverIdentifier})`,
    });
    operationIds = extractList(opsRes.raw).map((op) => op.id ?? op._id).filter(Boolean);
  }

  return {
    ok: true,
    identifier: driverIdentifier,
    me,
    currentDay,
    dayIds: dayList.map((d) => d.id).filter(Boolean),
    dayList,
    probeDayId,
    operationIds,
  };
}

async function probeDriverIsolation() {
  const driver2Identifier = process.env.API_PROBE_IDENTIFIER_2;
  const driver2Password = process.env.API_PROBE_PASSWORD_2;

  if (!driver2Identifier || !driver2Password) {
    report.driverIsolation = {
      skipped: true,
      reason: "Set API_PROBE_IDENTIFIER_2 and API_PROBE_PASSWORD_2 to compare two drivers",
    };
    report.summary.push(
      "Driver isolation probe skipped — set API_PROBE_IDENTIFIER_2 and API_PROBE_PASSWORD_2"
    );
    return;
  }

  console.log("\n--- Driver isolation probe ---");
  const driverA = await loginDriver(identifier, password);
  const driverB = await loginDriver(driver2Identifier, driver2Password);

  const comparison = {
    driverA,
    driverB,
    sameMeUserId: driverA.ok && driverB.ok && driverA.me.userId === driverB.me.userId,
    sameCurrentDayId:
      driverA.ok && driverB.ok && driverA.currentDay?.id && driverA.currentDay.id === driverB.currentDay?.id,
    overlappingDayIds:
      driverA.ok && driverB.ok
        ? driverA.dayIds.filter((id) => driverB.dayIds.includes(id))
        : [],
    overlappingOperationIds:
      driverA.ok && driverB.ok
        ? driverA.operationIds.filter((id) => driverB.operationIds.includes(id))
        : [],
  };

  comparison.isolationBroken =
    comparison.sameMeUserId ||
    comparison.sameCurrentDayId ||
    comparison.overlappingDayIds.length > 0 ||
    comparison.overlappingOperationIds.length > 0;

  report.driverIsolation = comparison;

  if (comparison.isolationBroken) {
    report.summary.push(
      "DRIVER ISOLATION BROKEN: two different logins returned overlapping user/day/operation data — backend must filter by JWT driver"
    );
    if (comparison.sameMeUserId) {
      report.summary.push(`  Both drivers share user id: ${driverA.me?.userId}`);
    }
    if (comparison.sameCurrentDayId) {
      report.summary.push(`  Both drivers share current day id: ${driverA.currentDay?.id}`);
    }
    if (comparison.overlappingDayIds.length) {
      report.summary.push(`  Overlapping day ids: ${comparison.overlappingDayIds.join(", ")}`);
    }
    if (comparison.overlappingOperationIds.length) {
      report.summary.push(
        `  Overlapping operation ids (${comparison.overlappingOperationIds.length}): ${comparison.overlappingOperationIds.slice(0, 5).join(", ")}`
      );
    }
  } else if (driverA.ok && driverB.ok) {
    report.summary.push("Driver isolation OK: two drivers received distinct day/operation data");
  } else {
    report.summary.push("Driver isolation probe incomplete — one or both logins failed");
  }

  console.log(
    comparison.isolationBroken
      ? "FAIL driver isolation — backend likely returns global driver data"
      : driverA.ok && driverB.ok
        ? "OK driver isolation"
        : "SKIP driver isolation (login failure)"
  );
}

function buildSummary() {
  const loginAnalysis = report.login?.analysis;
  if (loginAnalysis?.responseStyle?.includes("direct")) {
    report.summary.push("LOGIN: direct token payload (not { success, data }) — fixed in unwrap.ts");
  }

  for (const route of report.routes) {
    if (!route.ok) {
      if (route.status === 404 && route.path.includes("driver-days/current")) {
        report.summary.push(`${route.label}: 404 expected when no open day`);
      } else if (route.status !== 401) {
        report.summary.push(`${route.label}: HTTP ${route.status} — may need handler`);
      }
      continue;
    }
    for (const gap of route.analysis?.appExpectationGap ?? []) {
      report.summary.push(`${route.label}: ${gap}`);
    }
  }
}

function writeReport() {
  const outPath = join(__dirname, "api-probe-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
