# Verify Billing Dashboard

Standalone dashboard for billing calculation and per-organization **Excel report generation**, for Barikoi's Verify platform. It authenticates against the same backend as verify-admin-dashboard and calls the same existing backend APIs directly from the browser like v3 does (every request visible in the Network tab) — only the billing calculation and Excel report generation run server-side, in this app's own `/api/billing` route handlers.

> Agent/project guide: [AGENTS.md](AGENTS.md) · Design system: [docs/design.md](docs/design.md) · Exploration findings: [docs/billing-analysis.md](docs/billing-analysis.md)

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| UI | shadcn/ui (base-ui based, `base-nova` style) + Tailwind CSS v4 |
| State | Redux Toolkit |
| Auth | NextAuth v5 (beta) — Credentials provider, JWT strategy |
| Trip classification | Point-in-isochrone containment over bundled branch isochrones (`data/*_branches_isochrones.geojson`) — no routing API at billing time |
| Excel processing | SheetJS (`xlsx`) — reads the backend's BIFF `.xls`, writes the `.xlsx` report |
| Icons / Notifications | lucide-react / sonner |

## Getting started

```bash
npm install
cp .env.example .env         # fill in values
npm run dev                  # http://localhost:3000
```

Regenerating the branch isochrones (only needed when a branch dataset changes) requires the self-hosted GraphHopper server:

```bash
cd ../graphhopper-bd
./scripts/download.sh        # one-time: GraphHopper JAR + Bangladesh OSM extract
docker compose up -d         # first start imports OSM (10–20 min)
node scripts/generate-isochrones.mjs   # from this repo — writes data/*_branches_isochrones.geojson
```

### Branch isochrones

`data/brac_branches_isochrones.geojson` holds one distance-based isochrone Polygon per BRAC branch (the branch's `max_distance_km` serving radius, `category: "in"` for Dhaka branches / `"out"` for upcountry), generated offline by `scripts/generate-isochrones.mjs` against the self-hosted GraphHopper server (`../graphhopper-bd`, motorcycle profile). Billing never calls a routing API: `lib/billing/isochrones.ts` loads the file at runtime (parsed once per process — a regenerated file is picked up on server restart, no rebuild) and each trip end point is classified by point-in-polygon containment. Which org uses which file is decided in `data/org_registry.json` (`branches_isochrone` path + `isIsochroneUpdated` flag).

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Verify backend base URL (staging: `https://api.verify.barikoimaps.dev`, production: `https://api.verify.bmapsbd.com`) |
| `NEXTAUTH_SECRET` | NextAuth JWT signing (reuse v3's) |
| `GRAPHHOPPER_URL` | Only for isochrone regeneration (`scripts/generate-isochrones.mjs`; default `http://localhost:8989`) |

## How bill generation works

```
Bill Generation form (filters, rates, penalties, holidays)
   │  POST /api/billing/calculate  (Bearer token from session or Authorization header)
   ▼
app/api/billing/calculate  (server-side, Node runtime)
   │  1. POST backend /api/v2/reports/trip-status → downloads the raw trip-status .xls
   │  2. Parse rows (SheetJS; all original columns + values preserved)
   │  3. Classify every trip: IN / OUT / REMOTE  (see below)
   │  4. Rate + TAT Days + TAT Extra + Penalty + Price After Penalty per trip
   │  5. Generate the billing .xlsx and archive source/result under .data/billing/<runId>/
   ▼
Response streams the generated .xlsx back (browser downloads it)
```

### 1. Trip classification

Every trip is **revalidated server-side** — the backend's existing `in_out_remote` value is only a starting point. The final classification is written back into that column. Classification is fully local: a Dhaka-boundary test plus point-in-isochrone containment, no routing calls.

| Rule | Result |
| --- | --- |
| `in_out_remote` value is not IN/OUT/REMOTE | Left as-is; billing columns left empty (unclassified). |
| Coordinates inside the **Dhaka city corporation boundary** (`data/dhaka_city_corporation.geojson`) | `IN` — regardless of what the backend claimed. A claimed-`IN` trip outside the boundary is rejected (audited) and reclassified by the rules below. |
| Trip end point inside any **"in"-category** branch's isochrone (Dhaka branches) | `IN` — wins when isochrones overlap. |
| Trip end point inside any **"out"-category** branch's isochrone | `OUT`. |
| Trip end point inside no branch isochrone | `REMOTE` (`NO_ISOCHRONE_MATCH` in the audit column). |

Every containing branch is listed in the audit column as `<branch name> [<category>]`, so each classification is verifiable.

**Failure handling** — missing data must never become a guessed classification:

| Situation | Behavior |
| --- | --- |
| Missing/invalid trip coordinates | Classification cell becomes `INVALID_COORDINATES`; billing columns left empty. |
| Org has no current isochrone dataset (`data/org_registry.json`) | The backend's OUT/REMOTE verdict is kept verbatim; a rejected-IN row has no verdict to keep and is left unbilled (unclassified). |
| The org's isochrone file is missing/corrupt | The run fails loudly (`loadIsochrones()` throws) instead of billing without its rule set. |
| `in_out_remote` value is not IN/OUT/REMOTE | Left as-is; billing columns left empty. |

### 2. Per-trip billing calculation

| Column | Formula |
| --- | --- |
| `Rate` | Zone rate from the form: IN → In-Station rate, OUT → Out-Station rate, REMOTE → Remote rate. Never hardcoded. |
| `TAT Days` | `Submission Date − Receive Date − holidays strictly between the two dates`. The Receive Date does **not** count (the job can arrive at any time of that day); the Submission Date counts, and a holiday **on** it is not subtracted. Calendar-date math (UTC-based, timezone-safe); weekends are only excluded via the weekly holidays passed from the form. |
| `TAT Extra` | `MAX(0, TAT Days − SLA)` where SLA = 1 day (IN), 2 days (OUT), 3 days (REMOTE). |
| `Penalty` | `penalties.dayN` where N = `TAT Extra` (1–7 from the form; beyond 7 extra days, `day7` applies). Not cumulative. |
| `Price After Penalty` | `Rate − (Rate × Penalty / 100)`, rounded to 2 decimals. |

Examples: In-station trip completed in 2 TAT days → 1 extra day → `day1`% penalty (e.g. 150 → 135 at 10%). Remote trip in 3 days → 0 extra → full rate. OUT trip in 3 days → 1 extra day → `day1`% (200 → 180 at 10%).

Date cells arrive as Excel serial numbers or `mm-dd-yyyy AM/PM` strings — both are parsed to calendar dates before any comparison.

### 3. The generated Excel report

`Billing_Report_<dateFrom>_to_<dateTill>.xlsx`, sheet “Billing Report”:

- All **original columns, values, records and column order** preserved; `in_out_remote` updated with the final classification; dates keep date formatting (numeric cells, Excel builtin format).
- Appended columns: `Rate`, `TAT Days`, `TAT Extra`, `Penalty`, `Price After Penalty` (numeric cells), then the audit column **`Compared Branches And Distances`**.
- Numeric values are stored as numbers, not strings; unbillable rows leave the five billing columns blank.
- A grand-total row (`Grand Total — <N> billed trips` + the sum under `Price After Penalty`) is appended under the data.

The audit column makes every classification verifiable:

| Content | Meaning |
| --- | --- |
| `Gulshan Branch [in]` | Point inside that Dhaka branch's isochrone → IN. |
| `Gulshan Branch [in]; Tongi Branch [out]` | Overlapping isochrones — all containing branches listed; IN wins. |
| `Tongi Branch [out]` | Point inside an upcountry branch's isochrone → OUT. |
| `NO_ISOCHRONE_MATCH` | Point in no branch isochrone → REMOTE. |
| `IN claim rejected: coordinates outside the Dhaka city corporation boundary; Tongi Branch [out]` | Claimed-IN trip reclassified by containment after failing the boundary test. |
| empty | No containment happened (IN via Dhaka boundary, invalid coordinates, unclassified). |

### Performance

Sized for 15,000–16,000-row (30-day) reports: rows are processed in place (no copies) in a single synchronous pass. Each classification is two local geometric tests — a bounding-box pre-filter followed by an even-odd ray-cast over the 73 isochrone polygons (microseconds per row) — and the isochrone geojson is parsed once per process. Wall-clock time is dominated by the chunked backend download, not the calculation.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/billing/calculate` | POST | **New billing API** — downloads the trip-status export, classifies + bills every trip, streams the generated `.xlsx` back. Errors return JSON `{ success, message }` with 400/401/422/5xx. |
| `/api/auth-expired` | GET | clears session + revokes upstream token on logout |
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers |

Request body (all billing parameters come from the form):

```json
{
  "dateFrom": "2026-10-01",
  "dateTill": "2026-10-30",
  "page": 1,
  "org_id": ["79e1788b-4b40-48d3-ab51-25171779703d"],
  "status": [6, 7, 8],
  "billingType": "trip",
  "holidays": ["2026-10-02", "2026-10-03"],
  "rates": { "inStation": 150, "outStation": 200, "remote": 685 },
  "penalties": { "day1": 10, "day2": 20, "day3": 30, "day4": 40, "day5": 50, "day6": 60, "day7": 70 }
}
```

Existing backend endpoints used directly from the client (Bearer from session, via `clientAPI`): `AUTH.GET_USER`, `COMMON.GET_GROUP`, `BILL.GET_TRIP_HISTORY` — registered in `app.config.ts`. The billing route handler fetches `BILL.GET_TRIP_STATUS` server-side via `serverAPI`.

Success responses carry `X-Total-Rows`, `X-Billed-Trips` and `X-Total-Amount` headers (the UI shows the total in the download toast). While the request runs, the form disables the submit button and shows a non-dismissable progress dialog — large reports take 1–2 minutes.

## Architecture at a glance

```
Existing backend APIs (direct, Network-tab visible):
  Browser (client components) ── Bearer token from session ──▶ Verify backend

New billing APIs (server-side logic):
  Browser ──▶ app/api/billing/calculate ──▶ parse + classify + bill ──▶ .xlsx download
                     │  backend input data via Bearer token
                     ▼
              Verify backend

  Classification data (local files, no network at billing time):
    data/dhaka_city_corporation.geojson + data/brac_branches_isochrones.geojson (via data/org_registry.json)
```

- **Auth** — `auth.config.ts` / `auth.ts` / `proxy.ts`, login page at `app/login`, session carries `accessToken`, `user`, `permissions`, `vendor_id`. Next 16 proxy convention (`proxy.ts`) replaces v3's deprecated `middleware.ts`.
- **API layers** — `lib/api/client.ts` (client components → backend directly, Bearer from `useAuth().token`) and `lib/api/server.ts` (billing route handlers → backend input data, Bearer via `auth()` or the request's Authorization header). Do not import `serverAPI` from client code.
- **State** — Redux Toolkit in `lib/store` (`authSlice`, `billingSlice`), typed hooks (`useAppSelector`/`useAppDispatch`), per-feature slices.
- **Layout** — `app/(dashboard)` route group: shadcn sidebar + header, mobile Sheet nav, theme toggle, user dropdown, client session guard + background profile bootstrap.

## Project layout

```
app/
├── (dashboard)/
│   ├── layout.tsx                    # ProtectedRoute + bootstrapper + DashboardLayout
│   ├── _components/DashboardLayout/  # index (shell), Sidebar, Header
│   └── bill-generation/              # Bill Generation form (dates, org, statuses,
│       ├── page.tsx                  #   billing type, holidays, rates, penalties)
│       └── _components/BillGenerationClient.tsx
├── api/                              # NEW billing APIs only (server-side logic)
│   └── billing/calculate/route.ts    #   download → classify → bill → .xlsx download
├── login/page.tsx                    # shadcn login form
├── layout.tsx                        # SessionProvider + Redux + ThemeProvider + Toaster
└── page.tsx                          # redirect → /bill-generation
config/menu.ts                        # sidebar menu + page titles
data/
├── org_registry.json                  # org → isochrone file (branches_isochrone) + isIsochroneUpdated
├── brac_branches.json                 # BRAC branches: name, lat/lon, district,
│                                      #   max_distance_km (serving radius), category in/out
├── brac_branches_isochrones.geojson   # one Polygon per branch, category in/out (generated)
└── dhaka_city_corporation.geojson                      # Dhaka city corporation boundary (IN test)
lib/
├── api/{client,server,fetcher}.ts    # two-layer API (client → backend / routes → backend)
├── auth/clientAuth.tsx               # useAuth() hook (user, token, logout)
├── billing/
│   ├── branches.ts                   # Branch shape of data/*_branches.json
│   ├── calculate.ts                  # classification engine + TAT/penalty/price per trip
│   ├── chunked-run.ts                # ≤5-day chunked download + pipelined calculation
│   ├── dates.ts                      # timezone-safe calendar math, Excel serial parsing
│   ├── dhaka-boundary.ts             # Dhaka city boundary loader + IN test
│   ├── isochrones.ts                 # isochrone loader + point-in-isochrone containment
│   ├── org-branches.ts               # org → branch dataset registry
│   ├── org-isochrones.ts             # org → isochrone dataset registry (org_registry.json)
│   ├── parse.ts                      # .xls parsing (+ source date-format detection)
│   ├── point-in-polygon.ts           # shared ray-cast / bounding-box helpers
│   ├── report.ts                     # .xlsx report builder
│   ├── storage.ts                    # run archive under gitignored .data/billing/<runId>/
│   └── types.ts                      # row/column/summary types
├── store/                            # Redux store, Provider, authSlice, billingSlice
└── types/{auth,billing}.ts
```
