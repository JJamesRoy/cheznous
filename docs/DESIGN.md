# Chez Nous — Design system

> **Revision 2 (art direction).** The first pass (Geist on near-white, white 12px bordered cards,
> green on buttons and nav) read as a well-applied kit with no identity. Revision 2 follows the
> app-screen research of [taste-skill](https://github.com/Leonxlnx/taste-skill) (`references/app-screens.md`:
> colour on data not chrome, KPIs as type not tiles, flat surfaces, bimodal radii, figures under 48px,
> "give the product a face") with the *pastel consumer* style for money homes, given a Montréal face:
>
> - **Ground from the product's world:** Montréal greystone (`#f1f2ef`), cool and low-chroma — not
>   off-white, not cream. White cards sit on it **without borders** (a tone step is the edge).
> - **A figure face with character:** Manrope (variable, self-hosted via `@fontsource-variable/manrope`,
>   real tabular figures), body at a variable 450, headings 650. Geist Mono only for IDs/URLs.
> - **Ink, not brand, on actions:** primary buttons, the center « + », selected chips are near-black
>   (inverted in dark). Navigation selection is a neutral tone step.
> - **One hue, on data:** the iron green of Montréal's outdoor staircases marks the main data element
>   (the balance owed to you, progress fill, the current period) and doubles as `--positive`.
> - **People as themselves:** each partner has a stable person hue — first member river blue, second
>   ochre, the joint account the house green — as a pale tint with the dark ink of the same hue
>   (`src/lib/ui/people.tsx`). Identity only, never good/bad.
> - **Signature element:** *les trois colonnes* — Moi · Commun · partenaire — what each fronted this
>   month on shared expenses against the agreed ratio (dashboard and balances).
> - **App type is not display type:** the one answer figure is 34px (mobile) / 40px (desktop); titles
>   24–28px; nothing reaches 48px.
>
> Sections below are updated to these values; where an older value survives, revision 2 wins.

Clean, sharp, quiet. Near‑monochrome surfaces, precise type, hairline borders,
fast purposeful motion. Light and dark are designed separately; neither is an
inversion of the other.

All tokens live in `src/app/globals.css` as CSS variables and are exposed to
Tailwind v4 through `@theme inline`. Components never use raw hex values.

## 1. Color

### Neutral scale (12 steps, achromatic)

| Token | Role | Light | Dark |
|---|---|---|---|
| `--gray-1` | App background | `#fcfcfc` | `#0a0a0a` |
| `--gray-2` | Subtle background / sidebar | `#f8f8f8` | `#111111` |
| `--gray-3` | Surface (cards, rows hover) | `#f1f1f1` | `#181818` |
| `--gray-4` | Surface pressed / input bg | `#ebebeb` | `#1f1f1f` |
| `--gray-5` | Track (progress bars) | `#e3e3e3` | `#262626` |
| `--gray-6` | Strong border | `#d9d9d9` | `#2e2e2e` |
| `--gray-7` | Strong border hover | `#cecece` | `#3a3a3a` |
| `--gray-8` | Disabled foreground | `#bbbbbb` | `#4a4a4a` |
| `--gray-9` | Placeholder / icons | `#8d8d8d` | `#6e6e6e` |
| `--gray-10` | Tertiary text | `#6f6f6f` | `#808080` |
| `--gray-11` | Secondary text | `#565656` | `#a3a3a3` |
| `--gray-12` | Primary text | `#171717` | `#ededed` |

Semantic aliases used by components:

- `--bg` = gray‑1, `--bg-subtle` = gray‑2, `--surface` = white (light) / `#121212` (dark),
  `--surface-2` = gray‑3, `--fg` = gray‑12, `--fg-muted` = gray‑11, `--fg-subtle` = gray‑10.
- `--border` = 8% alpha of the foreground (`rgb(0 0 0 / 0.08)` light, `rgb(255 255 255 / 0.08)` dark).
  `--border-strong` = 14% alpha. Always 1px.

### Accent (single token)

`--accent` is the only brand color. Default: restrained deep green.

| | Light | Dark |
|---|---|---|
| `--accent` | `#1f6f4a` | `#52b586` |
| `--accent-fg` (text on accent) | `#ffffff` | `#06150e` |
| `--accent-soft` (active bg) | `rgb(31 111 74 / 0.08)` | `rgb(63 162 116 / 0.14)` |

Used only on data (the main data element), the focus ring and checked states. Actions use
`--primary` (near-black ink, inverted in dark). Changing `--accent` (and its two companions) re‑themes
the whole app.

### Money semantics (muted)

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--positive` | You are owed / under budget | `#2f7d5b` | `#55b386` |
| `--negative` | You owe / over budget | `#b5473a` | `#e0796b` |
| `--warning` | Approaching budget (≥ 85 %) | `#a86b12` | `#d9a144` |

Color is never the only signal: amounts carry a sign or a sentence
("te doit", "tu dois", "dépassé de"), bars carry a text label.

### Elevation

Elevation comes from surface tone + hairline border. Only floating layers
(menus, popovers, sheets, toasts) get one soft shadow: `--shadow-float`.
Cards never have shadows.

## 2. Typography

- **Manrope** (variable, self-hosted) for all UI and figures.
- **Geist Mono** only for IDs, URLs and the technical MCP screen.
- Scale (px): `12 / 13 / 14 / 16 / 20 / 28 / 40`, plus `--text-display: 52px` (mobile 44px)
  for the one hero number per screen. Tailwind tokens: `text-xs` 12, `text-sm` 13,
  `text-base` 14, `text-md` 16, `text-lg` 20, `text-xl` 28, `text-2xl` 40, `text-display`.
- Headings and large numbers: `letter-spacing: -0.02em` (≥ 20px) and `-0.03em` (display).
  Body: normal tracking.
- All amounts: class `num` → `font-variant-numeric: tabular-nums`.
- Inputs are `16px` on mobile (no iOS zoom), `14px` from `md` up.
- Weights: 400 body, 500 labels/emphasis, 600 headings. No bold 700 in UI.

## 3. Shape & space

- 4px grid. Spacing only from Tailwind's scale (multiples of 4px).
- Radii (soft, bimodal): `--radius-control: 10px` (buttons, inputs, chips), `--radius-inner: 12px`
  (nested blocks inside a card), `--radius-card: 20px` (cards, list groups), `--radius-sheet: 28px`
  (sheets, dialogs), `9999px` pills/avatars. No other radii; nested radii step down.
- Touch targets ≥ 44×44px on mobile (rows are 52px, icon buttons 44px).
- Icons: Lucide, stroke 1.5. 16px in dense UI, 20px in navigation.

## 4. Motion

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--dur-micro: 150ms;   /* press, hover, checkbox */
--dur-standard: 220ms; /* menus, popovers, list items */
--dur-large: 320ms;   /* sheets, page transitions */
```

Rules:

1. Animate only `transform`, `opacity`, `filter`. Never `transition: all`.
   Transitions name their properties explicitly.
2. Exits are ~30% faster than enters (`exit = enter × 0.7`).
3. Enter: `opacity 0→1`, `translateY 6px→0`, optional `blur(4px)→0`.
4. Press: `scale(0.97)` on buttons and tappable rows (`.pressable`).
5. Menus/popovers are origin‑aware: `transform-origin: var(--radix-*-content-transform-origin)`.
6. Tooltips: 400ms delay in, instant out.
7. Segmented controls and the tab bar use a sliding pill (`layoutId` with Motion).
8. Skeleton → content cross‑fades; skeletons reserve the exact final size (no layout shift).
9. Amounts that change animate with NumberFlow.
10. Sheets (Vaul) use spring physics for drag; open 320ms `--ease-out`.
11. `prefers-reduced-motion: reduce`: transforms and blurs are removed, opacity fades kept,
    NumberFlow animation disabled.
12. Haptics: `navigator.vibrate(8)` on key confirmations (expense saved, settlement
    recorded, item checked), feature‑detected. iOS Safari has no vibrate API: nothing is faked.

Motion is implemented with `LazyMotion` + `m` + `domAnimation` features only.

## 5. Components (born here)

All primitives in `src/components/ui/` are written against these tokens. Radix
provides behavior; styles are ours. Gallery‑inspired patterns that made the cut:

| Pattern | Where | Notes |
|---|---|---|
| Rolling number (NumberFlow) | Balance hero, budget remaining, totals | Respects reduced motion |
| Private amounts toggle | Header eye icon, `⌘⇧H` | Masks every `<Money>` as `•••,•• $` |
| Slide‑to‑confirm | Recording a settlement | Keyboard fallback: focus + Enter |
| Segmented control w/ sliding pill | Split mode, period toggles | |
| Split range | Percentage split | 1% steps, shows both sides |
| Drawn checkmark | Shopping items, checklist, tasks | SVG stroke‑dashoffset |
| Assignee picker (avatars) | Tasks, items | |
| Swipe actions | Expense rows, list items, tasks | Pointer‑based, threshold 72px |
| Pull to refresh | Mobile lists | Only in standalone/touch |
| Stacked toasts (Sonner) | Undo actions | Only for things not already visible |
| Dropzone → preview morph | Receipts | Client‑side compression before upload |

Rejected (anti‑slop): beams, meteors, sparkles, marquees, globes, particles,
tilt cards, spotlight cursors, gradient text, glass surfaces, KPI‑card grids.

## 6. Layout

### Mobile (primary)
- Bottom tab bar, 5 slots: **Accueil · Dépenses · + · Listes · Plus**. The center `+`
  opens quick add. "Plus" holds Tâches, Notes, Condo, Objectifs, Réglages.
- `100dvh`, `env(safe-area-inset-*)` on bars and sheets, `overscroll-behavior: none`
  on the body, `-webkit-tap-highlight-color: transparent`.
- All create/edit flows are bottom sheets (Vaul). Sheets track `visualViewport`
  so the keyboard never hides the active field.
- No horizontal scroll at 375px — verified by the screenshot suite.

### Desktop (≥ 1024px)
- Collapsible sidebar (240px / 56px), ⌘K command menu, shortcuts shown in `?` sheet:
  `N` new expense, `/` search, `G D` dashboard, `G E` expenses, `G L` lists, `G T` tasks,
  `G N` notes, `G C` condo, `?` help.
- Expense table: dense rows (40px), sortable columns, filters.
- Sheets become right‑side drawers or centered dialogs (max 480px).

## 7. Copy

Québec French, tutoiement, short. Vocabulary: épicerie, dépanneur, magasiner,
courriel, facture, reçu, frais de condo, taxe scolaire, hypothèque,
remboursement, « te doit ». Never: courses, e‑mail, mutuelle, charges de copropriété.

Toasts are specific and actionable ("Dépense ajoutée · Annuler"), never "Succès !".
Amounts: `Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' })` → `1 234,56 $`.
Dates: `1 nov. 2026`. Week starts Sunday by default.

## 8. Empty, loading, error

- **Empty**: one line of context + one clear action. No illustration.
- **Loading**: skeleton blocks with the final dimensions, cross‑fade in.
- **Error**: inline, says what failed and offers "Réessayer". Offline gets its own message.

## 9. Accessibility

- Text contrast ≥ 4.5:1 (body) / 3:1 (≥ 20px) in both themes. `--fg-subtle` is only
  used at ≥ 13px for non‑essential metadata and still meets 4.5:1 on `--bg`.
- Focus ring: `2px` `--accent` outline, `2px` offset, visible on keyboard focus only.
- Every icon button has an `aria-label`. Amount masking keeps an accessible label
  ("Montant masqué").
