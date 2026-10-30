# Billing System — Exploration Findings

Findings from exploring the projects, data files, and existing code before
implementing the billing calculation. Written 2026-10-30.

## 1. Business context

Verify performs physical address/information verification for banks. When a
customer applies for a loan or credit card, the bank assigns verification tasks;
field representatives visit the address and verify. Banks are billed per
completed trip, priced by zone:

| Zone | Definition (initial rule) |
| --- | --- |
| **IN** (In Station) | Trip within Dhaka City |
| **OUT** (Out Station) | Outside Dhaka City, within a district town, close to a branch of the respective bank |
| **REMOTE** | Trip far from the nearest branch of the respective bank |

More billing rules and edge cases to be supplied separately (not yet received).

## 2. Project relationships

```
Verify-Billing-Dashboard (this repo)
│  Bill Generation form → POST /api/billing/calculate (own route handler)
│     └─ server-side: download trip-status .xls → parse → classify → rate
│        → generate billing Excel → return as download
│
├─ calls backend POST /api/v2/reports/trip-status with the session Bearer
│  token (NextAuth JWT → session.accessToken, attached in lib/api/server.ts)
│
├─ graphhopper-bd — Dockerized GraphHopper 11.1 on :8989 (road distances)
│     └─ helper/nearest_branch.py — reference nearest-branch implementation
│
└─ spt_point_to_network_check.py — prototype: is a trip point "served" by a
   branch within that branch's own serving radius (GraphHopper /spt endpoint)
```

Architecture rules that bind the implementation (from `AGENTS.md`):

- Existing backend APIs are called **directly from client components**
  (`lib/api/client.ts`); only the NEW billing APIs live in `app/api/billing/**`
  route handlers.
- Route handlers fetch backend input data via `serverAPI` (`lib/api/server.ts`)
  with the session Bearer token; `serverAPI` must never be imported client-side.
- Billing calculation and report generation logic stay **server-side**.

## 3. The trip-status export (input API)

`POST {NEXT_PUBLIC_API_BASE_URL}/api/v2/reports/trip-status` — registered as
`BILL.GET_TRIP_STATUS` in `app.config.ts`. Responds with a file download.

Request body (JSON):

```json
{
  "dateFrom": "2026-09-01",
  "dateTill": "2026-09-01",
  "page": 1,
  "org_id": ["79e1788b-4b40-48d3-ab51-25171779703d"],
  "action_date_type": "END_DATE"
}
```

Notes:

- The curl example hits **production** `https://api.verify.bmapsbd.com`; the
  `.env` currently points at **staging** `https://api.verify.barikoimaps.dev`.
- The Bearer token is the backend API token stored in the NextAuth JWT
  (`auth.config.ts` credentials login → `token.accessToken`).
- Existing wrapper: `serverAPI.billing.downloadTripStatus()` in
  `lib/api/server.ts` (POST, 5-minute timeout, returns
  `{ buffer, contentType, fileName }`).

## 4. The downloaded Excel report (input data)

- Confirmed a **true BIFF8 .xls** (OLE2 Composite Document), not an
  HTML/CSV-in-disguise — SheetJS parses it fine (`xlsx` dep, already declared
  in package.json).
- Exactly 28 columns, in order:

  `DepositId, RefId, VerificationTypeName, VerificationStatus, ContactPerson,
  ContactPersonsDesignation, OwnerNameStatus, NatureOfBusiness, SignBoardStatus,
  NatureOfBusinessStatus, MobileVerificationStatus, Relation, Comments, Remarks,
  Latitude, Longitude, VerificationDateTime, ResidenceType, StayOfDuration,
  Address, Receive Date, InsideDhakaMetro, AddressApproachStatus, District,
  Thana, in_out_remote, ApplicationStatus`

- `in_out_remote` values present in data: `IN` / `OUT` / `REMOTE`.
- Sample row (1-day sample file, 2026-09-01):

  ```
  DepositId            DP00650918
  RefId                A6E2QTFT0XYOLG92SGD35VC3K
  VerificationTypeName DepositorResidentAddressVerification
  VerificationStatus   Successful
  Latitude/Longitude   24.380436 / 88.624686
  VerificationDateTime 46266.7785648148   ← Excel serial datetime
  Receive Date         08-30-2026 8:15:26 PM
  InsideDhakaMetro     No
  District/Thana       Rajshahi / (thana)
  in_out_remote        OUT
  ApplicationStatus    SUBMITTED
  ```

- `VerificationDateTime` arrives as an **Excel serial number** (e.g.
  `46266.778…`); `Receive Date` as a string. Parsing must handle both.
- Scale: 1 day ≈ 663 records (630 KB); a 30-day report ≈ 15,000–16,000
  records. Parsing/rating must stay streaming-friendly and avoid unnecessary
  copies (current `rows.map` with spread is acceptable at this size, but no
  intermediate duplication beyond that).

Local reference file: `data/Trip_Status_Report_2026-09-01_2026-09-01.xls`.

## 5. Target output format (discovered in git history)

`git status` shows two tracked-but-deleted files that are a **finished billing
output** (BRAC Bank PLC, Sept 2026, 14,668 rows):

- `data/BBPLC_Sept2026_bankCopy.xlsx`
- `data/BBPLC_Sept2026_bankCopy.xlsx - Reg+TAT_14668.csv` (same data as CSV)

This is the de-facto spec for the Excel the API must generate. It keeps the
trip columns (reordered slightly) and appends billing columns:

| Added column | Meaning / observed values |
| --- | --- |
| `Bill?` | `YES` (all rows in the reference) |
| `barikoi_district` | District reverse-geocoded from trip lat/lon via Barikoi (Dhaka 8,725 · Chattogram 950 · Gazipur 756 · …) — replaces the input's bank-side `District`/`Thana` |
| `barikoi_sub_district` | Sub-district from the same geocode (e.g. Vatara, Savar, Juri) |
| `in_out_remote` | `IN` 8,106 / `OUT` 6,172 / `REMOTE` 390 |
| `Rate` | IN=150, OUT=200, REMOTE=685 (flat per-zone rates; matches the form defaults) |
| `Tat Days` | 0–8 (turnaround days; 9,447 rows had 1) |
| `TATExtra` | Days beyond allowed TAT (0–6) |
| `Penalty%` | = TATExtra × 10 (observed 0–60; form allows day1–day4 = 10/20/30/40) |
| `PriceAfterPenalty` | = Rate × (1 − Penalty%/100), e.g. 150→135.0, 200→180.0 |
| `branch` | Nearest bank branch name — populated only on REMOTE rows (389 ≈ 390 REMOTE) |
| `br_lat`, `br_lon` | Branch coordinates (same population) |
| `br_dist` | **Road** km to that branch (e.g. 43.967 where haversine ≈ 36.6) → GraphHopper-derived |

Also inserts a `Submission Date` column (e.g. `9-1-26 14:03`, batch-level
value) that is **not** in the trip-status export.

Observations for the OUT/REMOTE split: a Dhaka-district row with sub-district
Savar is OUT (`InsideDhakaMetro=No`), so classification is not merely
district-based — the branch serving radius (or metro flag) participates.

## 6. Current state of `/api/billing/calculate`

`app/api/billing/calculate/route.ts` already implements:

1. Payload validation (ISO dates, non-empty `org_id`/`status`, rates present).
2. `serverAPI.billing.downloadTripStatus(...)` → `.xls` buffer (5-min timeout).
3. Persists source file + `request.json` under gitignored
   `.data/billing/<runId>/` (`lib/billing/storage.ts`).
4. `parseTripStatusFile()` (`lib/billing/parse.ts`) — SheetJS read, first
   sheet, `defval: ""`, required-column check.
5. `applyRates()` (`lib/billing/calculate.ts`) — flat rate per normalized
   zone, builds `BillSummary`.
6. Responds with JSON: `{ success, runId, sourceFile, resultFile, summary,
   preview }`.

**Missing pieces:** Excel generation of the billing report, the
file-download response, reverse geocoding (barikoi_district /
barikoi_sub_district), zone classification (if recomputed rather than trusted
from the export), branch distance enrichment (REMOTE rows), TAT/holiday +
penalty computation, and frontend handling of the binary response (currently
the client `fetch`s JSON and just toasts the row count).

Frontend form (`BillGenerationClient.tsx`) already collects: date range,
organization, statuses, action_date_type, billingType (`trip` | `location`),
weekly + extra holidays, rates, SLA penalties (day1–day4) — all forwarded in
the payload (`CalculateBillPayload`, `lib/types/billing.ts`).

## 7. Supporting assets

### `data/brac_branches.json`

73 BRAC Bank branches: `branch_name`, `lat`, `lon`, `max_distance_km`
(58×35, 14×30, 1×25), `district`/`area`/`division`, `category`
(5 `in` — the Dhaka branches: Ashkona, Demra, Islampur, Mirpur Section 1,
Uttara Sonargaon Janapath; 68 `out`).

### graphhopper-bd

- GraphHopper 11.1, Bangladesh-only Geofabrik extract, Docker (ports
  8989 API / 8990 admin), CH speed mode → ~1 ms per route query.
- Profiles: `car` (built-in model) and `motorcycle_bd` (custom model in
  `custom_models/` — the built-in motorcycle model avoids motorways and
  inflates BD distances ~25%).
- First start imports OSM (10–20 min); `graph-cache/` is the built graph.
- Reference usage: `GET /route?point=lat,lon&point=lat,lon&profile=car&points_encoded=false&instructions=false`
  → `paths[0].distance` (meters), `paths[0].time` (ms). `GET /nearest`
  snaps a raw GPS point to a road.
- `helper/nearest_branch.py`: per trip, haversine-prefilter K=5 branches →
  route each → shortest road distance wins; outputs
  `branch_id, route_km, route_minutes, straight_line_km, snap_start_m,
  snap_end_m, error`. Snap distance > ~200 m ≈ bad GPS fix.
- **Not running** as of 2026-10-30 (nothing on `localhost:8989`).

### `spt_point_to_network_check.py` (dashboard repo root)

Prototype for the "served by a branch" check using GraphHopper `/spt`:

1. Build a shortest-path tree from the trip point (`distance_limit=40 km`,
   must be ≥ the largest branch radius).
2. Each returned road segment carries its network distance from the trip.
3. A branch is `on_network` if it snaps within 100 m of a segment;
   `serving` = on_network **and** network distance ≤ the branch's own
   `max_distance_km` × 1000.
4. Emits nearest/2nd/3rd nearest branches + distance and a `served` flag.

This is the likely engine for OUT (served by a branch) vs REMOTE (not
served) classification. Requires pandas/geopandas/shapely (not installed).

## 8. Open items (awaiting the detailed billing rules)

- Whether `in_out_remote` is taken from the export as-is or **recomputed**
  (reverse geocode → metro/district check → branch serving radius).
- Exact TAT definition: which dates bound `Tat Days` (`Receive Date` →
  `Submission Date`?), how weekly/extra holidays shift it, and the
  allowed-TAT baseline (TATExtra = Tat Days − N?).
- Whether `Bill?` can ever be something other than YES (e.g. failed
  verifications, canceled statuses).
- Pagination: can a 15–16k-row period really come back in one xls for
  `page: 1`, or must the route iterate pages / accept a page size?
- Org → branch mapping (only BRAC branches exist in `data/` so far).
- Which routing profile (car vs motorcycle) and which distance rule
  (shortest road distance vs serving-radius test) is authoritative for
  `br_dist` and the OUT/REMOTE boundary.
- GraphHopper dependency for classification: dev/production hosting of the
  :8989 service is undefined in the dashboard code so far.
