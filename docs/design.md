# Design System — Verify Billing Dashboard

UI built with shadcn/ui on base-ui primitives ("base-nova" style) + Tailwind CSS v4. This document defines the visual language so every page stays consistent. Light/dark themes via `next-themes` (class strategy).

## Foundations

### Color

Token-driven (CSS variables in `app/globals.css`, oklch). Base palette: zinc neutrals; primary is a blue (`--primary: oklch(0.5 0.134 242.749)`). Use semantic tokens only — never raw hex values:

| Token | Use |
| --- | --- |
| `background` / `foreground` | page canvas / body text |
| `card` / `card-foreground` | card + popover surfaces |
| `popover` / `popover-foreground` | menus, dropdowns, sheets |
| `primary` / `primary-foreground` | brand actions (primary Button, brand mark, active checkbox) |
| `secondary` / `secondary-foreground` | softer emphasis |
| `muted` / `muted-foreground` | subtle surfaces / de-emphasized text |
| `destructive` | errors, destructive actions |
| `border` / `input` / `ring` | hairlines, input borders, focus rings |
| `sidebar*` tokens | sidebar surface, border, accents |

### Typography

- Sans: Inter (`--font-sans`), body default `text-sm`. Mono: Geist Mono (`--font-mono`) for numbers/code/version strings.
- Scale in use: page title `text-lg font-semibold` · card titles `text-sm font-semibold` · body/labels `text-sm`/`text-xs` · helper/caption `text-xs text-muted-foreground` · version `text-[0.625rem] font-mono`.
- The whole UI runs at standard shadcn base-nova sizing — buttons h-8 default (`text-sm`), compact `xs`/`sm` variants only where density is needed (table toolbars) — do not scale up per-page.

### Radius & elevation

- Radius scale from `--radius` (sm → 4xl). Buttons/inputs/cards use the nova component defaults (`rounded-lg`); brand mark `rounded-md`.
- Flat design: borders instead of heavy shadows. Shadows only for overlays (popover/sheet/dialog), provided by the ui components.

### Spacing & layout metrics

| Metric | Value |
| --- | --- |
| Sidebar width | `w-56` (14rem), fixed, `bg-sidebar`, border-r |
| Header height | `h-12`, sticky, `border-b bg-background` |
| Content padding | `p-4` (mobile) → `md:p-6` |
| Content max width | `max-w-5xl mx-auto` for module pages |
| Vertical rhythm | `space-y-6` between page sections, `gap-2` label→field, `gap-4` between form fields |

## Theming

- `next-themes`, `attribute="class"`, default `system`. Toggle in the header; keyboard hotkey `d` (existing template behavior).
- Dark mode = `.dark` class + token overrides; components adapt automatically — no per-component dark: overrides unless custom surfaces (use `dark:bg-input/30` style input treatment already in ui components).

## Components

- **Only shadcn/ui** (`components/ui/*`) — no antd, no other UI kits. Add with `npx shadcn@latest add <name>`.
- **base-ui specifics:** custom triggers use `render={<Component />}` (NOT radix `asChild`); Checkbox `onCheckedChange` yields a boolean.
- Icons: lucide-react with `Icon`-suffixed names (`MenuIcon`), sized `size-4` (inside buttons they auto-size via the component), `text-muted-foreground` for de-emphasis.
- Buttons: `size="sm"` inline in headers, `size="default"` for form actions, `variant="outline"` secondary, `variant="ghost"` for icon actions, `variant="destructive"` errors-only. Full-width submit buttons `w-full` (login).
- Forms: `Label` + `Input` in `grid gap-2`; inline field errors `text-xs text-destructive` under the field; `aria-invalid` on inputs.
- Feedback: toasts via `sonner` (`toast.error/success`), inline state text `text-xs` (`text-destructive` for errors, `text-muted-foreground` for neutral status).
- Loading: `<Spinner className="size-3.5" />` inside buttons, `size-6` for page-level guards; `Skeleton` for content placeholders.

## Layout patterns

### Dashboard shell

Fixed left sidebar (`w-56`, brand + nav from `config/menu.ts`), mobile: Sheet (side="left") from the header menu button. Sticky h-12 header: mobile menu button (lg:hidden) → page title (from `getPageTitle`) → right side: theme toggle, vertical Separator, user dropdown (avatar + name, label with email, Sign out).

### Module page

```
<div className="mx-auto w-full max-w-5xl space-y-6">
  header: title + description + (badge/status)
  content cards
</div>
```

Page header pattern: `h2` `text-lg font-semibold` + `p` `text-sm text-muted-foreground` description. Cards section content; use the grid `gap-3 sm:grid-cols-3` for feature/summary card grids.
