# LabelHub Design Brief

You are a senior product designer with a portfolio at Linear / Vercel / Anthropic quality. Produce a complete visual design system and high-fidelity mockups for the following product.

## 1. Product

**LabelHub** — *"Capture the teaching, not just the label."*

An AI-native annotation marketplace for the LLM era. Two-sided market:
- **Publishers** post tasks (rate model outputs, write SFT demonstrations, do RLHF preference ranking, evaluate agent traces, red-team prompts).
- **Annotators** browse, take tasks, submit work, see their impact.
- Same user can be both.
- **One engine, 6 template modes**: Classic Survey · Pair Annotation (human + AI) · Arena Battle (LMSYS-style) · Token Economy · Game Mode (streaks/leagues) · Apprentice Mode (personal AI partner).

**Direct competitors**: Scale AI, Surge AI, Outlier, ByteDance Xpert, Toloka.

## 2. Target user

ML engineers, AI researchers, and domain experts (lawyers, doctors, coders) at frontier AI labs. They use Linear, Vercel, Raycast daily. They are senior, smart, and busy. **Not a consumer product. No hand-holding.**

## 3. Aesthetic philosophy

**Calm intelligence over loud novelty.** Every pixel deliberate.

**Emulate (priority order)**:
1. **Linear** — density, restraint, motion, keyboard-first feel
2. **Vercel dashboard** — monochrome + accent, generous whitespace
3. **Anthropic.com / Claude.ai** — thoughtful, intellectual, calm
4. **Raycast** — brand mark quality, polished command surfaces
5. **Notion** — content-first list layouts

**Reject (you have failed if your output looks like this)**:
- Bootstrap / Material default
- Soft-pastel "wellness app" vibes
- "AI startup" with rainbow gradients across the hero
- 2010s flat design with primary-color buttons
- Mascots, stock photos, illustrations with floating geometric shapes
- Heavy drop shadows, glassmorphism overdose, skeuomorphism

## 4. Color system (OKLCH only — for perceptual uniformity)

**Mostly monochrome** (zinc/neutral) + **one accent**.

- Accent: `oklch(0.6 0.18 280)` — sophisticated violet (Anthropic-adjacent, evokes "thinking AI")
- Light bg: `oklch(0.99 0 0)`; Dark bg: `oklch(0.13 0 0)`
- Semantic colors — used SPARINGLY:
  - Success: `oklch(0.65 0.13 150)` muted forest
  - Warning: `oklch(0.7 0.13 80)` muted amber
  - Danger: `oklch(0.6 0.2 25)` muted brick
- **Dark mode first.** Light is the secondary theme.

## 5. Typography

- **Sans**: Geist Sans. Tight tracking on headings (`letter-spacing: -0.02em` at 24px+).
- **Mono**: Geist Mono. Used for: IDs, timestamps, code, tabular numbers.
- **Scale**: 12 / 13 / 14 / 16 / 20 / 24 / 32 / 48px. No values in between.
- **Line-height**: 1.5 body, 1.2 headings.
- Tables and dashboards use `font-variant-numeric: tabular-nums`.

## 6. Spacing / layout

- 4px base unit. Use 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Max content width 1280px on wide screens. Sidebar 240px.
- Cards: 1px border, 12px radius, hover lifts `translateY(-1px)` — no shadow.

## 7. Motion

- Framer Motion + React 19.2 View Transitions.
- Spring physics, not eased. Durations 150-250ms.
- List stagger 50-80ms.
- Page transitions: cross-fade only. No slide.
- Forbidden: bouncy / jelly / over-the-top reveals.

## 8. Component conventions

- **Buttons**: ghost / outline / solid. Solid uses accent OR foreground, never both.
- **Inputs**: 1px border, no inner shadow, focus ring 2px offset.
- **Badges**: small, sentence case, no uppercase tracking.
- **Tabs**: 1px underline indicator, no pill backgrounds.
- **Empty states**: 1 sentence + 1 CTA. No illustrations.
- **Avatars**: simple circles, initials in mono.

## 9. Screens to design (deliver all 8)

### S1. Landing page
Hero headline: **"Capture the teaching, not just the label."** (48px, tight tracking). One subhead, one CTA. Below: 6-card grid of template modes, each card visually distinct — Game Mode reads chip-tile, Web3 has subtle holographic accent, Classic shows grid lines, Pair Annotation shows two cursors converging. No hero image. No marketing fluff.

### S2. Template selector (workspace creation)
6 large cards (3×2 grid). Each card: mode name + 1-line description + a tiny animated micro-thumbnail expressing the mode. Selected card lifts, others dim to 60%.

### S3. Workspace dashboard
Left sidebar (240px) — My Tasks · Task Marketplace · Guidelines · Insights · Settings. Top bar — workspace switcher, notifications, profile. Main — task cards in a Linear-style list with status badges and reward column.

### S4. Task marketplace
Filter chips on top (task type, reward range, deadline). Cards — title, 2-line description, reward in mono, pending-count badge, "Enter" button. Hover expands details inline (no modal).

### S5. Annotation workspace (the most important screen)
Three-column layout:
- **Left** (260px): task spec + Living Guidelines feed (with recent rule patches highlighted)
- **Center** (flex): the item being annotated — design Classic Survey + Pair Annotation + Arena Battle variants
- **Right** (320px): Claude pair-suggestion panel (with accept / edit / reject) + reasoning capture text area + Trust Score widget

**Critical**: design the rubric grid where 1000 rows × 4 model columns must stay smooth. Show a subtle "12 / 847 visible" virtualization indicator. Atomic checkboxes per cell. No jank vibe.

### S6. "Watch Your Model Learn" dashboard (the hero feature)
A big hero chart: model accuracy over time. Inline annotation pills like "+0.9% from your last 5 labels". Below the chart: an impact feed ("Your labels improved factuality 78% → 81%"). A model "fitness" gauge in the corner.

### S7. My Growth (annotator personal)
Trust Score: huge mono number top-left. Skills radar (4-6 axes). Streak counter. "Top areas of improvement" list. Time-on-task histogram.

### S8. Settings (workspace admin)
Plain-text settings grouped by category — like Linear or Notion's settings page. One tab: **PerfBudget configurator** — sliders for `maxItemsPerCell`, `virtualizationRequired` toggle, `autoSavePolicy` radio — with live validation that rejects unsafe combinations.

## 10. Copy tone

Confident, intellectual, terse. Annotators are "experts" / "labelers" / "you" — never "users". No exclamation marks. Almost no emoji. Sentence case in subheads. Numbers in mono.

## 11. Deliverables

1. Color palette (light + dark, OKLCH values)
2. Typography scale with usage rules
3. Component library: button, input, textarea, select, checkbox, radio, badge, card, tabs, modal, table, chart, avatar, breadcrumb, command palette
4. All 8 screens above as high-fidelity mockups
5. A 30-second animation storyboard for the "Watch Your Model Learn" curve growing live
6. Hover + focus + disabled + loading states for every interactive element
7. Mobile breakpoint: design S3 (dashboard) and S4 (marketplace) — collapse sidebar to bottom nav

Output the design system first, then screens in order. Use Tailwind class names where applicable. Avoid Lorem ipsum — write realistic LabelHub copy (task names like "Evaluate Claude 4.7 reasoning on Olympiad math", "SFT for medical Q&A", etc.).
