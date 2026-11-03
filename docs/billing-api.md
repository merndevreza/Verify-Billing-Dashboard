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
                               │ branchesForOrgs
                               │ processBilling ──▶ graphhopper (road distances)
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
- **Optional filters:** `status` and `action_date_type` are only added to the
  payload when the user actually chose them (`if (data.statuses.length > 0)` /
  `if (data.action_date_type)`). The API works with just org + date range.
- Required fields are marked `*` in the UI; Status, Sort By, Billing Type and
  Holidays are optional.

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
`status`/`action_date_type` from the JSON body when they are `undefined` —
the backend then runs unfiltered. One response carries all matching rows. The
request has a 5-minute timeout because exports can be slow. A non-200
`status` inside the envelope (the backend reports failures inside a 200
HTTP response) becomes a `502` carrying the backend's `message`.

## Step 3 — The run archive opens

**File:** `lib/billing/storage.ts` — `newRunId()`, `saveRunFile()`

Every calculation gets a folder `.data/billing/<runId>/` (gitignored):

| File                | Written at   | Content                       |
| ------------------- | ------------ | ----------------------------- |
| `source.json`       | Step 3       | the raw backend response      |
| `request.json`      | Step 3       | the submitted payload         |
| `summary.json`      | Step 7       | result + how the run decided  |
| `billing_report.xlsx` | Step 7     | the generated report          |

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

## Step 5 — Which org's branch rules apply?

**Files:** `lib/billing/org-branches.ts` → `branches.ts`

`branchesForOrgs(payload.org_id)` resolves each org uuid (numeric ids also
work) through `ORG_BRANCHES` — a registry built by matching the `org_uuid` in
each `data/*_branches.json` against `data/org_data.json`. Currently only
`data/brac_branches.json` (Brac Bank PLC) exists; every other org gets
`branches: null`.

Result: `{ orgName, branches }` — or `null` when ANY selected org has no
dataset. Mixed selections never get branch checks; that is deliberate.

**To onboard a new org:** drop `data/<org>_branches.json` (same shape) and add
one entry to `BRANCH_FILES` in `org-branches.ts`.

## Step 6 — The billing engine

**File:** `lib/billing/calculate.ts` — `processBilling(rows, params)`

`params` carries rates, the 7-step penalty ladder, holidays and the org's
branch list. Work is distributed over 8 async workers pulling from a shared
cursor (single-threaded JS, so the cursor is race-free).

### 6a. Classification — `classify(row)`

Decides IN / OUT / REMOTE for one row, in this exact order:

1. **Rule 1:** backend said `IN` → stays `IN`, done.
2. Backend said anything but `OUT`/`REMOTE` → `null` (counted as
   `unclassified`).
3. **No branch dataset** (`branches: []`) → the backend's OUT/REMOTE is kept
   verbatim, audit note `"organization has no branch dataset; backend
   classification kept"`. Non-Brac orgs live entirely on this path.
4. **Step A — district sadar** (`branches.ts: isDistrictSadarAddress`):
   address contains "<District> Sadar" (normalization handles
   "COX'S BAZAR SADAR") → `OUT`, no routing.
5. **Dhaka rule** (`branches.ts: isDhakaDistrict`): Dhaka-district trips are
   always `OUT` here — inside-metro ones already stayed IN via Rule 1.
6. **Step B** (`branches.ts: branchesForDistrict` via `districtBranchIndex`,
   category `"out"` branches only, with `DISTRICT_ALIASES` smoothing
   spellings like Bogura/Bogra): no eligible branch in the district →
   `REMOTE` (Rule 11.B).
7. Invalid coordinates → `INVALID_COORDINATES` marker.
8. **Straight-line prefilter** (`haversineM` from the active router file):
   road distance ≥ straight-line, so a branch whose own `max_distance_km` is
   already exceeded by the straight line can never yield OUT — its route call
   is skipped (lossless). Survivors are tried nearest-first.
9. **Road distance** (`routeWithCache` → `routeDistanceM`): first branch that
   fits its radius settles `OUT` (remaining branches are not routed);
   `REMOTE` only when EVERY candidate was measured and exceeded. Any failed
   measurement → `ROUTE_DISTANCE_UNAVAILABLE` — the row is never guessed.
   - 30 consecutive failures trip the circuit breaker (`routerDown`) for the
     rest of the run.
   - Results are cached per `branch.id + ~11 m grid` so overlapping trips
     share route calls.

**Router provider** is chosen by which import is active at the top of
`calculate.ts` — `graphhopper.ts` (self-hosted, `GRAPHHOPPER_URL`) or
`barikoi-routing.ts` (`BARIKOI_API_KEY`). Both export the same
`routeDistanceM` / `haversineM` / `ROUTER_PROVIDER` contract.

### 6b. TAT + penalty — `applyBilling(row, zone)`

- Rate per zone: `rates.inStation` / `outStation` / `remote`.
- Dates via `lib/billing/dates.ts`: `parseCalendarDate()` accepts Excel serial
  numbers or display strings; all math is UTC-based so the host timezone
  never skews `TAT Days` (`diffCalendarDays` + 1, minus
  `countHolidaysBetween` — endpoints excluded).
- SLA days: IN 1, OUT 2, REMOTE 3 (`EXPECTED_DAYS`). Extra days pick the
  matching `penalties.day1…day7` percent (beyond 7 → day7), applied as
  `Price After Penalty = rate × (100 − penalty) / 100`.
- Unparseable dates → `tatUnavailable`, billing columns stay empty.

## Step 7 — Build the Excel report

**File:** `lib/billing/report.ts` — `buildBillingWorkbook()`

The workbook has two sheets, **"Billing Summary" first**:

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
open for the duration (reports can take minutes).

---

## Failure semantics (all deliberate)

| Outcome                     | Where decided            | Effect on the row            |
| --------------------------- | ------------------------ | ---------------------------- |
| `400`                       | `route.ts: validate()`   | request rejected             |
| `422` unusable response     | `route.ts` catch         | runId + sourceFile returned  |
| `422` zero rows             | `route.ts`               | filters were wrong, no bill  |
| `ROUTE_DISTANCE_UNAVAILABLE`| `classify()`             | row skipped, never guessed   |
| `INVALID_COORDINATES`       | `classify()`             | row skipped                  |
| `unclassified`              | `classify()`             | `in_out_remote` not IN/OUT/REMOTE |
| `tatUnavailable`            | `applyBilling()`         | classification kept, no price|

All counts land in `summary.json` next to `request`, `branchDatasetOrg`
(which org's rules ran) and `routingProvider` — an archive can always answer
"what produced this bill?".
