# Verify Billing Dashboard

Standalone dashboard for billing calculation and per-organization CSV report generation, for Barikoi's Verify platform. It authenticates against the same backend as [verify-admin-dashboard-v3](../verify-admin-dashboard-v3) and calls the same existing backend APIs directly from the browser like v3 does (every request visible in the Network tab) — only the billing calculation and CSV report generation run server-side, in this app's own `/api/billing` route handlers.

> Agent/project guide: [AGENTS.md](AGENTS.md) · Design system: [docs/design.md](docs/design.md)

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| UI | shadcn/ui (base-ui based, `base-mira` style) + Tailwind CSS v4 |
| State | Redux Toolkit |
| Auth | NextAuth v5 (beta) — Credentials provider, JWT strategy |
| Icons | lucide-react |
| Notifications | sonner |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values (staging backend URL + NextAuth secret)
npm run dev                  # http://localhost:3000
```

`.env.local` is pre-filled with the staging backend (same one v3 uses). `NEXTAUTH_SECRET` can be reused from v3's `.env.local`.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Architecture at a glance

```
Existing backend APIs (direct, Network-tab visible):
  Browser (client components) ── Bearer token from session ──▶ Verify backend

New billing APIs (server-side logic):
  Browser ──▶ app/api/billing/** route handlers ──▶ calculation + CSV generation
                     │  backend input data via Bearer token from session
                     ▼
              Verify backend
```

- **Auth** — `auth.config.ts` / `auth.ts` / `proxy.ts`, login page at `app/login`, session carries `accessToken`, `user`, `permissions`, `vendor_id`. Next 16 proxy convention (`proxy.ts`) replaces v3's deprecated `middleware.ts`.
- **API layers** — `lib/api/client.ts` (client components → backend directly, Bearer from `useAuth().token`) and `lib/api/server.ts` (billing route handlers → backend input data, Bearer via `auth()`). Do not import `serverAPI` from client code.
- **State** — Redux Toolkit in `lib/store` (`authSlice`, `billingSlice`), typed hooks (`useAppSelector`/`useAppDispatch`), per-feature slices.
- **Layout** — `app/(dashboard)` route group: shadcn sidebar + header, mobile Sheet nav, theme toggle, user dropdown, client session guard + background profile bootstrap.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/billing/calculate` | POST | **New billing API** — own server-side calculation/CSV logic (placeholder, returns 501 until implemented) |
| `/api/auth-expired` | GET | clears session + revokes upstream token on logout |
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers |

Existing backend endpoints used directly from the client (Bearer from session, via `clientAPI`): `AUTH.GET_USER`, `COMMON.GET_GROUP`, `BILL.GET_TRIP_HISTORY` — registered in `app.config.ts`.

## Project layout

```
app/
├── (dashboard)/
│   ├── layout.tsx                    # ProtectedRoute + bootstrapper + DashboardLayout
│   ├── _components/DashboardLayout/  # index (shell), Sidebar, Header
│   └── bill-generation/              # placeholder module — completed later
│       ├── page.tsx
│       └── _components/BillGenerationClient.tsx
├── api/                              # NEW billing APIs only (server-side logic)
├── login/page.tsx                    # shadcn login form
├── layout.tsx                        # SessionProvider + Redux + ThemeProvider + Toaster
└── page.tsx                          # redirect → /bill-generation
config/menu.ts                        # sidebar menu + page titles
lib/
├── api/{client,server,fetcher}.ts    # two-layer API (client → own routes → backend)
├── auth/clientAuth.tsx               # useAuth() hook (user, token, logout)
├── store/                            # Redux store, Provider, authSlice, billingSlice
└── types/auth.ts
```
