# Claude Design prompt — `/my/queue`

Copy everything between the `=====` lines into Claude Design as a single
prompt. Paste your existing landing-page screenshot as a style reference
so the output matches the LabelHub visual language.

=====

Design a single-page React component for an **annotation work queue**.

## Context

This is the daily landing page for a human annotator working on a
multi-tenant AI-trace evaluation platform called LabelHub. The user is
signed in, belongs to one or more "workspaces" (companies), and each
workspace has a backlog of agent trajectories (LLM execution traces)
that need human ratings. Today, opening a trajectory takes 6 clicks
from sign-in. This page should reduce it to 2.

The visual style is: light theme, neutral grays, a single violet accent
(oklch ~0.6 0.18 280). Mono font (Geist Mono) for IDs and small
metadata, sans (Geist Sans) for body. Cards have 1px hairline borders,
8-12px radius, plenty of whitespace. Think Linear × Anthropic × Vercel.
NO emojis except `★ ⚡ ↻ →` and similar single-glyph indicators.

## Layout

Single-column, max-width ~960px, centered. Three sections stacked
vertically:

### 1. Header block
- Top label: small mono caps `§ MY QUEUE` (mute color)
- H1: large sans-serif "What's next" (the page title)
- Subtitle: one line, mute color: "Ranked by where your mark will move
  the needle most — open disputes first, then your drafts, then
  peer-rated, then fresh captures."

### 2. Stats strip (4 small cards in a grid)
- Card 1: "done today" — big number, violet accent if >0
- Card 2: "in progress" — drafts I haven't submitted yet
- Card 3: "all-time" — total submitted forever
- Card 4: "disputes broken" — count + small "today" subtitle

Each card: ~140-180px wide, 1px hairline border, 8px radius, mono
24px number, 11px uppercase label above.

### 3. Workspace filter (chip row)
ONLY shown if the user is in 2+ workspaces. A row of pill-style chips:
- First chip: "all" (selected by default, violet bg + white text when active)
- Then one chip per workspace the user belongs to
- Inactive chips: panel-2 bg + line border + text color
- Active chip: violet bg, white text
- Each chip is a link that adds `?workspaceId=<uuid>` to the URL

### 4. Queue list (the main content)

A vertical list of cards. EACH card represents one trajectory needing
annotation. Layout per card:

```
┌──────────────────────────────────────────────────────────┐
│ [PRIORITY BADGE] agent/name  workspace-name · 47 steps   │
│                                                start → │
│                                                          │
│ One-paragraph summary of what the agent did (220 chars   │
│ max, truncated with ellipsis if longer).                 │
└──────────────────────────────────────────────────────────┘
```

- Card padding: ~16px
- Cards stack vertically with 12px gap between them
- The whole card is a clickable link to the annotator URL
- Hover: subtle border-color shift + slight cursor change

#### Priority badge variants

Four states, each a small mono pill with 1px border + colored bg/fg:

| Priority | Visual | Label |
|---|---|---|
| `dispute` | red bg (danger-soft) + red text + red border | `⚡ 1 dispute` or `⚡ N disputes` |
| `resume` | yellow bg + warn text + yellow border | `↻ resume` |
| `peer` | violet bg (accent-soft) + violet text + accent-line border | `peer-rated` |
| `fresh` | gray bg (panel-2) + mute text + line border | `fresh` |

The **whole card's left border color** should ALSO shift:
- `dispute` → red border (oklch 0.55 0.2 25 / 0.4)
- `resume` → yellow border
- `peer` and `fresh` → default line color

Right side of header row: small mono violet "start →" link affordance.

#### Empty state
If the queue is empty: a dashed-border card centered with text "You're
all caught up" as h3 + subtitle "No trajectories awaiting your
annotation. New captures will land here automatically — refresh in a
few minutes."

## Props the component receives

```typescript
{
  stats: {
    doneToday: number
    inProgress: number
    doneAllTime: number
    disputesBrokenToday: number
  }
  workspaces: Array<{
    workspaceId: string
    workspaceName: string
    role: 'admin' | 'annotator'
  }>
  activeWorkspaceId: string | null  // null = "all"
  items: Array<{
    trajectoryId: string
    workspaceId: string
    workspaceName: string
    agentName: string
    rootPromptPreview: string  // already truncated to 180 chars
    summaryPreview: string | null  // AI-generated, may be null
    stepCount: number
    createdAt: Date
    disputeCount: number
    priority: 'dispute' | 'resume' | 'peer' | 'fresh'
    inProgress: boolean
  }>
}
```

For card body text, use `summaryPreview` if present, otherwise fall
back to `rootPromptPreview`. Truncate display to ~220 chars with `…`.

Card link URL: `/workspaces/{workspaceId}/trajectories/{trajectoryId}/annotate`

Workspace chip URLs: `/my/queue?workspaceId={workspaceId}` and just `/my/queue` for "all".

## Don'ts

- No emojis other than the four single-glyph indicators noted above
- No drop shadows; we use 1px hairline borders everywhere
- No gradients except a SUBTLE one inside the stat cards if you want
- No icons that aren't single Unicode chars (avoid heroicons / lucide)
- The accent color is ONLY for the "active" chip, the "start →" link,
  the doneToday number when >0, and one or two other emphasis spots —
  not for every CTA

## CSS variables available

```
--bg          page background (very light gray)
--panel       card background (white-ish)
--panel2      slightly darker panel (subtle nested)
--line        hairline border (~oklch 0.92)
--line2       slightly darker line
--text        body text
--hi          headings + emphasis text (near black)
--mute        secondary text
--mute2       tertiary text / labels
--accent      violet oklch(0.6 0.18 280)
--accent-soft accent at low alpha for backgrounds
--accent-line accent border at low alpha
--danger      red
--danger-soft red soft bg
--warn        yellow
--success     green
--success-soft soft green bg
```

Use these variables, NOT hardcoded hex colors.

## Output

A single TSX file as a Next.js Server Component. Default-export a
function `MyQueuePage` that takes the props above. No client-side
state needed for the basic render (filtering is URL-driven via the
chip links). Use the existing `Link` from `next/link` for navigation.

=====

After Claude Design returns the TSX:

1. Save it as `src/components/queue/queue-client.tsx` (or similar)
2. Paste into the chat and I'll wire it into `src/app/my/queue/page.tsx`
3. The current placeholder UI in that file is set up so the swap is
   a single `<QueueClient>` substitution — no SSR rewiring needed
