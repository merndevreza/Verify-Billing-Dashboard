# Billing Calculate API — the full story

How `POST /api/billing/calculate` turns a form submission into a billed Excel
report. Read this top to bottom and you know every file the request touches,
in the order it touches them.

```
BillGenerationClient.tsx        route.ts                    lib/billing/*
┌────────────────────┐   POST  ┌──────────────────┐
│ form ── onSubmit() │ ──────▶ │ validate()       │
│ fetch + Bearer     │         │ fetchSlaStatus ──▶ backend (sla-status JSON)
└────────────────────┘         │ parseSlaStatusResponse
                               │ branchesForOrgs + isochronesForOrgs
                               │ processBilling ──▶ isochrone containment (local polygons)
                               │ buildBillingWorkbook
                               └──────┬───────────┘
                          .xlsx download + summary.json archive
```

---

## Step 0 — The form builds the payload

**File:** `app/(dashboard)/bill-generation/_components/BillGenerationClient.tsx`

`onSubmit()` collects the React Hook Form values into a `CalculateBillPayload`
(shape: `lib/types/billing.ts`) and POSTs it with the session's backend token:

```ts
Authorization: Bearer <token>        // same token the backend already knows
```

- **Required by the API:** `dateFrom`, `dateTill` (ISO `yyyy-mm-dd`), a
  non-empty `org_id` array (org **uuids**), `rates`, `penalties`.
- **Optional filters:** `status` is only added to the payload when the user
  actually chose statuses (`if (data.statuses.length > 0)`). The API works
  with just org + date range.
- Required fields are marked `*` in the UI; Status, Billing Type and Holidays
  are optional.

## Step 1 — The route handler receives the request

**File:** `app/api/billing/calculate/route.ts` — `POST()`

This is the ONLY kind of billing logic allowed in a route handler: NEW
server-side billing endpoints (existing backend APIs are called from the
client, per AGENTS.md).

1. `validate()` checks the payload and returns a human-readable message per
   failure → `400 { success, message }`.
2. `bearerToken()` extracts the Bearer token from the request header (falls
   back to the NextAuth session token deeper down).

## Step 2 — Fetch the input data from the backend

**File:** `lib/api/server.ts` — `serverAPI.billing.fetchSlaStatus()`

POSTs to the backend's sla-status report (`app.config.ts` →
`Endpoints.BILL.GET_SLA_STATUS`) and returns the JSON payload
(`{ data: TripStatusRow[], message, status }`). The request body is unchanged
from the retired trip-status export: `TripStatusRequest` omits
`status` from the JSON body when it is `undefined` —
the backend then runs unfiltered. One response carries all matching rows. The
request has a 5-minute timeout because exports can be slow. A non-200
`status` inside the envelope (the backend reports failures inside a 200
HTTP response) becomes a `502` carrying the backend's `message`.

## Step 3 — The run archive opens

**File:** `lib/billing/storage.ts` — `newRunId()`, `saveRunFile()`

Every calculation gets a folder `.data/billing/<runId>/` (gitignored):

| File                    | Written at        | Content                            |
| ----------------------- | ----------------- | ---------------------------------- |
| `request.json`          | before Step 2     | the submitted payload              |
| `source-chunk-NN.json`  | per chunk         | the raw backend response of a chunk |
| `chunks.json`           | end of the run    | per-chunk download/calculation audit |
| `summary.json`          | Step 7            | result + how the run decided       |
| `billing_report.xlsx`   | Step 7            | the generated report               |

`runId` is also returned to the caller as the `X-Run-Id` response header —
quote it when auditing a report.

## Step 4 — Parse the response into rows

**File:** `lib/billing/parse.ts` — `parseSlaStatusResponse()`

It:

- verifies the payload carries a `data` array — otherwise throws, which the
  route turns into `422` with the `runId` + `sourceFile` path,
- verifies `REQUIRED_COLUMNS` on the raw rows — a backend field rename fails
  loudly instead of billing on blanks,
- normalizes each row into `TripStatusRow[]` (`lib/billing/types.ts` mirrors
  the field names): nulls (e.g. `Thana`) become `""` and columns are emitted
  in `TRIP_STATUS_COLUMNS` order so the report keeps a stable column order,
- fails with `422` when `data` has **zero rows** (wrong filters, not a bill),
- leaves `dateFormats` empty — dates arrive as Excel serial numbers and the
  report applies its `DEFAULT_DATE_FORMAT`.

## Step 5 — Which org's isochrone rules apply?

**Files:** `lib/billing/org-branches.ts` → `branches.ts`, `lib/billing/org-isochrones.ts`

`branchesForOrgs(payload.org_id)` resolves each org uuid (numeric ids also
work) through `ORG_BRANCHES` — a registry built by matching the `org_uuid` in
each `data/*_branches.json` against `data/org_data.json`. Currently only
`data/brac_branches.json` (Brac Bank PLC) exists. It supplies the org name
for the report and the archive.

`isochronesForOrgs(payload.org_id)` resolves the org's isochrone dataset
through `data/org_registry.json`: an org classifies through isochrone
containment only when it has a `branches_isochrone` path **and**
`isIsochroneUpdated: true`. Result: `{ orgName, file }` — or `null` when ANY
selected org has no current dataset. Mixed selections never get branch rules;
that is deliberate.

**To onboard a new org:** generate `data/<org>_branches_isochrones.geojson`
with `scripts/generate-isochrones.mjs` (needs the self-hosted GraphHopper
server, `../graphhopper-bd`), then set `branches_isochrone` +
`isIsochroneUpdated` in `data/org_registry.json`.

## Step 6 — The billing engine

**File:** `lib/billing/calculate.ts` — `processBilling(rows, params)`

`params` carries rates, the 7-step penalty ladder, holidays and the org's
branch isochrones (`loadIsochrones()` in `lib/billing/isochrones.ts` — read
from disk once per process and cached, so a regenerated file is picked up on
server restart without a rebuild). `processBilling` is fully synchronous:
every classification is a local point-in-polygon test, no routing calls.

### 6a. Classification — `classify(row)`

Decides IN / OUT / REMOTE for one row, in this exact order:

1. Backend's `in_out_remote` is anything but IN/OUT/REMOTE → `null`
   (counted as `unclassified`).
2. **Step 0 — Dhaka boundary** (`lib/billing/dhaka-boundary.ts`, over
   `data/dhaka_city_corporation.geojson`): coordinates inside the Dhaka city corporation
   boundary → `IN`, no matter what the backend claimed. A claimed-`IN` row
   outside the boundary is rejected (audited) and falls through to the
   isochrone steps like any other non-IN row.
3. **No current isochrone dataset** (`isochrones: []`) → the backend's
   OUT/REMOTE is kept verbatim, audit note `"organization has no branch
   isochrone dataset; backend classification kept"`. Non-Brac orgs live
   entirely on this path. A rejected-IN row has no backend OUT/REMOTE verdict
   to keep and no rule set to reclassify with, so it is left unbilled
   (`unclassified`) with the rejection noted.
4. Invalid coordinates → `INVALID_COORDINATES` marker (containment is
   undefined without a point).
5. **Isochrone containment** (`lib/billing/isochrones.ts` →
   `findIsochroneMatches`): the trip end point is tested against every branch
   isochrone of the org's geojson (bounding-box pre-filter, then even-odd
   ray-cast — no network calls).
   - inside any **"in"-category** branch's isochrone (Dhaka branches) →
     `IN` (wins when isochrones overlap);
   - else inside any **"out"-category** branch's isochrone → `OUT`;
   - else → `REMOTE` (`NO_ISOCHRONE_MATCH` in the audit column).

Every containing branch is listed in the audit column as
`<branch name> [<category>]` (e.g. `Gulshan Branch [in]; Tongi Branch [out]`),
so each classification is verifiable; a rejected-IN row carries the
`IN claim rejected: …` prefix ahead of its matches.

### 6b. TAT + penalty — `applyBilling(row, zone)`

- Rate per zone: `rates.inStation` / `outStation` / `remote`.
- Dates via `lib/billing/dates.ts`: `parseCalendarDate()` accepts Excel serial
  numbers or display strings; all math is UTC-based so the host timezone
  never skews `TAT Days` (`diffCalendarDays`, minus `countHolidaysBetween`
  — the Receive day is not counted; holiday endpoints excluded).
- SLA days: IN 1, OUT 2, REMOTE 3 (`EXPECTED_DAYS`). Extra days pick the
  matching `penalties.day1…day7` percent (beyond 7 → day7), applied as
  `Price After Penalty = rate × (100 − penalty) / 100`.
- Unparseable dates → `tatUnavailable`, billing columns stay empty.

## Step 7 — Build the Excel report

**File:** `lib/billing/report.ts` — `buildBillingWorkbook()`

The workbook has four sheets, **"Billing Summary" first**:

- **Billing Summary** (`buildSummarySheet` + `penaltyBreakdown`): run context
  (org, billing period, generated timestamp), Total/Billed trips, Total
  Amount, classification counts, not-billed reasons, and a penalty table
  bucketed by TAT Extra days (0…6, `7+`) showing trips, penalty %, rate total
  and penalty amount per bucket. Aggregated from the billed rows, so it
  always matches the data sheet.
- **Billing Report**: original columns in original order (with updated
  `in_out_remote` values), plus `BILLING_COLUMN_HEADERS` from
  `lib/billing/types.ts`: `Rate`, `TAT Days`, `TAT Extra`, `Penalty`,
  `Price After Penalty`, `Compared Branches And Distances` (the per-row audit
  trail from `classify()`). Date cells use the report's default date format;
  a grand-total row closes the sheet.
- **Request Details** (`buildRequestDetailsSheet`): the request behind the
  bill and its generator — the session user (name + email), billing period,
  organization (name + uuids), the `status` filter rendered as label strings
  (`APPLICATION_STATUS_LABELS` in `lib/types/billing.ts`: 6 = Submitted, 7 =
  Partially Submitted, 8 = Withdrawn; absent = "All statuses"), billing type,
  the forwarded holiday dates, and the three rates.
- **Chunk Details** (`buildChunkDetailsSheet`): per-chunk
  download/calculation audit, always the last sheet.

`billingReportFileName()` names the file
`Billing_Report_<from>_to_<till>.xlsx`.

## Step 8 — The response

`route.ts` returns the `.xlsx` with:

| Header            | Meaning                              |
| ----------------- | ------------------------------------ |
| `X-Run-Id`        | archive folder handle for audits     |
| `X-Total-Rows`    | rows in the export                   |
| `X-Billed-Trips`  | rows with a complete bill            |
| `X-Total-Amount`  | sum of Price After Penalty           |

The client (`BillGenerationClient.tsx`) turns the body into a browser
download, reads the headers for the success toast, and keeps a loading dialog
open for the duration (the backend download is chunked and strictly
sequential).

---

## Failure semantics (all deliberate)

| Outcome                     | Where decided            | Effect on the row            |
| --------------------------- | ------------------------ | ---------------------------- |
| `400`                       | `route.ts: validate()`   | request rejected             |
| `422` unusable response     | `route.ts` catch         | runId + sourceFile returned  |
| `422` zero rows             | `route.ts`               | filters were wrong, no bill  |
| `INVALID_COORDINATES`       | `classify()`             | row skipped                  |
| `unclassified`              | `classify()`             | `in_out_remote` not IN/OUT/REMOTE, or a rejected-IN row with no isochrone dataset |
| `tatUnavailable`            | `applyBilling()`         | classification kept, no price|
| missing/corrupt isochrone file | `loadIsochrones()`    | run fails loudly — no billing without the rule set |

All counts land in `summary.json` next to `request`, `branchDatasetOrg`
(which org's rules ran), `dhakaBoundary` (the IN-validation source) and
`isochroneDataset` (the containment source, null when the backend verdicts
were kept) — an archive can always answer "what produced this bill?".
