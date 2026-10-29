<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Verify Billing Dashboard — Agent Guide

Standalone billing dashboard for Barikoi's Verify platform. Next.js 16 App Router + React 19 + shadcn/ui (base-ui) + Tailwind v4 (NOT antd). Authenticates against the same backend as verify-admin-dashboard-v3 (../verify-admin-dashboard-v3) and reuses its APIs, but all backend calls are proxied through this app's own /api route handlers with the session Bearer token attached server-side.

## Commands

- Dev: `npm run dev` · Build: `npm run build` · Lint: `npm run lint` · Format: `npm run format`
- Verification = **typecheck + build only**: `npx tsc --noEmit` and `npm run build` must pass — that is the whole check. No manual browser verification, no screenshots.
- **Do not commit.** No remote configured; the user commits manually.

## Workflow rules (override any plugin/skill defaults)

- **Implement directly.** For every task — bug fix, UI tweak, small/medium feature — skip brainstorming, design specs, implementation plans, and subagent dispatch. Make the change in as few steps as possible. Only ask clarifying questions when the request is genuinely ambiguous.
- The user lists their steps explicitly; follow them in order, exactly as specified, no unrequested extras.
- Verification = typecheck + build.

## Architecture

- `app/` — Next.js 16 App Router. `(dashboard)/` = authed group, `login/` public, `api/` route handlers.
- `app.config.ts` — central backend endpoint registry (AUTH, COMMON, DASHBOARD, BILL). Backend = same as v3 (`NEXT_PUBLIC_API_BASE_URL`).
- `auth.config.ts` / `auth.ts` / `proxy.ts` — NextAuth v5 beta (Credentials, JWT). `proxy.ts` is Next 16's renamed middleware (v3's `middleware.ts` is deprecated): protected `/` + `/bill-generation`, public `/login`. The backend API token rides the JWT as `session.accessToken`; server-side consumers get it via `auth()` inside route handlers; client components never need it.
- **API rules (the owner debugs via the browser Network tab):**
  - Existing backend APIs are called DIRECTLY from client components — `lib/api/client.ts` (`clientAPI`) + `lib/api/fetcher.ts`, with the Bearer token from the session (`useAuth().token`). Never proxy or mask them with route handlers.
  - ONLY the NEW billing APIs live in `app/api/` route handlers (`app/api/billing/**`). Their calculation/report-generation logic is server-side; they fetch backend input data via `lib/api/server.ts` (`serverAPI`, `apiErrorResponse`), which attaches the session Bearer token upstream. Never import `serverAPI` from client code.
- **Server-side calculations rule:** billing calculation and CSV report generation logic lives in this app's own route handlers (`app/api/billing/**`), not in the browser — the browser calls these NEW endpoints; the handlers may pull backend input data server-side via `serverAPI`.
- **Redux:** `lib/store` — `store.ts` (`makeStore`, typed hooks `useAppSelector`/`useAppDispatch`), `Provider.tsx`, per-feature slices. Current slices: `authSlice` (profile + permissions via non-blocking bootstrap), `billingSlice` (organizations, trip history, calculation). New modules get their own slice; import actions directly from slice files.
- `config/menu.ts` — sidebar menu + page titles. `components/ui/` — shadcn (base-ui) components; add with `npx shadcn@latest add <name>`.
- **Data flow:** client component → Redux thunk → `clientAPI` → backend (Bearer from session, Network-tab visible). NEW billing APIs: client → `app/api/billing/**` route handler → `serverAPI` for backend input data → calculation logic server-side. Page routes under `app/(dashboard)/**` are thin wrappers around a colocated `_components/*Client.tsx`.
- Design system: `docs/design.md`. shadcn base-ui style: triggers use `render={<Component />}` (not radix `asChild`), compact sizing (h-7 buttons, text-xs body), lucide `*Icon`-suffixed imports.

## Env vars

- `NEXT_PUBLIC_API_BASE_URL` — backend base URL (staging: https://api.verify.barikoimaps.dev)
- `NEXTAUTH_SECRET` — NextAuth JWT signing (reuse v3's)
- See `.env.example`; `.env*` is gitignored.

## Permissions

`session.user.permissions` gates UI (same shape as v3). Vendor id: `session.user.vendor_id`. Org-level gating is expected to be handled at the API layer server-side; add client-side permission checks only when a requirement needs them.

## Stack gotchas

- **Next 16:** `middleware.ts` deprecated → use `proxy.ts` (same exports + `config.matcher`).
- **shadcn base-ui:** triggers use `render={<Component />}`; Checkbox `onCheckedChange` gives a boolean; `DropdownMenuLabel` renders `Menu.GroupLabel` and must sit inside a `DropdownMenuGroup` (runtime error otherwise).
- **No antd anywhere.** Prefer Tailwind utilities; only add a CSS file when a trick genuinely requires it.
- Auth secret: this repo standardizes on `NEXTAUTH_SECRET` (Auth.js v5 also accepts `AUTH_SECRET`).
- Don't delete the `nextjs-agent-rules` block at the top of this file — `next dev` re-adds it anyway.
