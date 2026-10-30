# Verify Billing Dashboard

Standalone dashboard for billing calculation and per-organization **Excel report generation**, for Barikoi's Verify platform. It authenticates against the same backend as [verify-admin-dashboard-v3](../verify-admin-dashboard-v3) and calls the same existing backend APIs directly from the browser like v3 does (every request visible in the Network tab) — only the billing calculation and Excel report generation run server-side, in this app's own `/api/billing` route handlers.

> Agent/project guide: [AGENTS.md](AGENTS.md) · Design system: [docs/design.md](docs/design.md) · Exploration findings: [docs/billing-analysis.md](docs/billing-analysis.md)

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| UI | shadcn/ui (base-ui based, `base-mira` style) + Tailwind CSS v4 |
| State | Redux Toolkit |
| Auth | NextAuth v5 (beta) — Credentials provider, JWT strategy |
| Routing distances | Self-hosted GraphHopper 11.1 (see [graphhopper-bd](../graphhopper-bd)) **or** Barikoi routing API — switchable with one import in `lib/billing/calculate.ts` |
| Excel processing | SheetJS (`xlsx`) — reads the backend's BIFF `.xls`, writes the `.xlsx` report |
| Icons / Notifications | lucide-react / sonner |

## Getting started

```bash
npm install
cp .env.example .env         # fill in values
npm run dev                  # http://localhost:3000
```

Start the routing server (required for Out/Remote classification when using the GraphHopper provider):

```bash
cd ../graphhopper-bd
./scripts/download.sh        # one-time: GraphHopper JAR + Bangladesh OSM extract
docker compose up -d         # first start imports OSM (10–20 min)
```

### Routing provider

`lib/billing/calculate.ts` picks the distance provider with one import — both files export the same interface:

```ts
import { haversineM, routeDistanceM } from "./graphhopper"        // self-hosted GraphHopper
// import { haversineM, routeDistanceM } from "./barikoi-routing" // Barikoi routing API
```

The Barikoi provider needs `BARIKOI_API_KEY` in `.env` and uses the `motorcycle` profile. Note the two engines weight roads differently, so distances (and a few boundary OUT/REMOTE rows) can differ between providers — the `Compared Branches And Distances` audit column always shows the distances actually used.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Verify backend base URL (staging: `https://api.verify.barikoimaps.dev`, production: `https://api.verify.bmapsbd.com`) |
| `NEXTAUTH_SECRET` | NextAuth JWT signing (reuse v3's) |
| `GRAPHHOPPER_URL` | Routing server (default `http://localhost:8989`) |
| `BARIKOI_API_KEY` | Barikoi routing API key (only for the Barikoi provider) |

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

Every trip is **revalidated server-side** — the backend's existing `in_out_remote` value is only a starting point. The final classification is written back into that column.

| Rule | Result |
| --- | --- |
| Existing classification is `IN` | Stays `IN`. No distance calculation. |
| Address contains the trip's district name followed by “Sadar” | `OUT` — inside the district's sadar area, no branch check needed. |
| District is Dhaka (outside the metro; inside-metro trips are already `IN`) | `OUT` — confirmed business rule, no branch check. |
| Otherwise: look up branches in `data/brac_branches.json` whose `district` matches the trip's district (`category: "out"` only) | No eligible branch → `REMOTE` (billing continues normally). |
| Straight-line prefilter | Branches already farther than their own `max_distance_km` **by straight line** are skipped without routing (road distance ≥ straight-line, so they can never win) — lossless. |
| Motorcycle **road distance** (GraphHopper `motorcycle` profile) to each surviving candidate; shortest wins | Shortest road distance ≤ that branch's `max_distance_km` → `OUT`, otherwise → `REMOTE`. |

District spellings are normalized before matching, with aliases for common variants (Bogura/Bogra, Jashore/Jessore, Chittagong/Chattogram, Barisal/Barishal, Comilla/Cumilla, …), so a spelling mismatch never silently reclassifies a district as Remote.

**Failure handling** — a failed lookup must never become a wrong classification:

| Situation | Behavior |
| --- | --- |
| GraphHopper cannot route a trip | Classification cell becomes `ROUTE_DISTANCE_UNAVAILABLE`; billing columns left empty; the row is preserved; the run continues. |
| Router down for the whole run (30 consecutive failures) | Remaining route-dependent rows short-circuit to `ROUTE_DISTANCE_UNAVAILABLE` instead of hammering a dead server. |
| Missing/invalid trip coordinates | Classification cell becomes `INVALID_COORDINATES`; billing columns left empty. |
| `in_out_remote` value is not IN/OUT/REMOTE | Left as-is; billing columns left empty. |

### 2. Per-trip billing calculation

| Column | Formula |
| --- | --- |
| `Rate` | Zone rate from the form: IN → In-Station rate, OUT → Out-Station rate, REMOTE → Remote rate. Never hardcoded. |
| `TAT Days` | `(Verification Date − Receive Date) + 1 − holidays strictly between the two dates`. Both endpoints count; a holiday **on** the Receive or Verification date is not subtracted. Calendar-date math (UTC-based, timezone-safe); weekends are not excluded. |
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

The audit column makes every classification verifiable:

| Content | Meaning |
| --- | --- |
| `Sylhet Branch: 12.34 km; …` | Each branch routed for this trip and its motorcycle road distance (shortest one decides OUT/REMOTE). |
| `Jessore Branch: straight-line 80.33 km > 35 km limit, not routed` | Branch skipped by the straight-line prefilter. |
| `Dhaka district; no branch check` / `district-sadar address; no branch check` | Classified without routing. |
| `no eligible branch for district "X"` | Rule: no matching branch → Remote. |
| `Shariatpur Sub branch: route failed` | Routing failed — row is `ROUTE_DISTANCE_UNAVAILABLE`. |
| empty | No comparison happened (IN trips, invalid coordinates, unclassified). |

### Performance

Sized for 15,000–16,000-row (30-day) reports: rows are processed in place (no copies), route calls are prefiltered by straight-line distance, cached per branch + ~11 m coordinate key, run with bounded concurrency (8 workers), and a circuit breaker stops route calls when the router is down. The 663-row sample report processes in well under a second against a local GraphHopper.

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
  "action_date_type": "END_DATE",
  "billingType": "trip",
  "holidays": ["2026-10-02", "2026-10-03"],
  "rates": { "inStation": 150, "outStation": 200, "remote": 685 },
  "penalties": { "day1": 10, "day2": 20, "day3": 30, "day4": 40, "day5": 50, "day6": 60, "day7": 70 }
}
```

Existing backend endpoints used directly from the client (Bearer from session, via `clientAPI`): `AUTH.GET_USER`, `COMMON.GET_GROUP`, `BILL.GET_TRIP_HISTORY` — registered in `app.config.ts`. The billing route handler fetches `BILL.GET_TRIP_STATUS` server-side via `serverAPI`.

## Architecture at a glance

```
Existing backend APIs (direct, Network-tab visible):
  Browser (client components) ── Bearer token from session ──▶ Verify backend

New billing APIs (server-side logic):
  Browser ──▶ app/api/billing/calculate ──▶ parse + classify + bill ──▶ .xlsx download
                     │  backend input data via Bearer token        ▲
                     ▼                                             │ motorcycle road distances
              Verify backend  ────────────────────▶  GraphHopper (graphhopper-bd, :8989)
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
└── brac_branches.json                # bank branches: name, lat/lon, district,
                                      #   max_distance_km (serving radius), category in/out
lib/
├── api/{client,server,fetcher}.ts    # two-layer API (client → backend / routes → backend)
├── auth/clientAuth.tsx               # useAuth() hook (user, token, logout)
├── billing/
│   ├── branches.ts                   # branch index, district normalization/aliases, sadar check
│   ├── calculate.ts                  # classification engine + TAT/penalty/price per trip
│   ├── dates.ts                      # timezone-safe calendar math, Excel serial parsing
│   ├── graphhopper.ts                # motorcycle road-distance client + haversine
│   ├── parse.ts                      # .xls parsing (+ source date-format detection)
│   ├── report.ts                     # .xlsx report builder
│   ├── storage.ts                    # run archive under gitignored .data/billing/<runId>/
│   └── types.ts                      # row/column/summary types
├── store/                            # Redux store, Provider, authSlice, billingSlice
└── types/{auth,billing}.ts
```
