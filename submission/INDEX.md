# LabelHub — Submission Index (spec §8 deliverables)

> **Judges start here.** This is the single entry point to every required
> submission artifact. Each row links the deliverable, says in one line what it
> is, and gives an **honest status**. Paths are relative to this file:
> `../` is the repository root; `./` is this `submission/` directory.

**Live demo:** **https://aipert.top** — the deployed, running platform (the
annotation core; gateway entry points hidden by focus mode, see
`ARCHITECTURE.md` §5).

**One-line product:** an Owner builds tasks and drag-and-drop form templates →
Labelers annotate → an AI agent pre-reviews each submission → human Reviewers
accept or send back → datasets export as JSON / JSONL / CSV / Excel.
Stack: Next.js 16 (App Router) · React 19 · TypeScript (strict) ·
Drizzle ORM / Postgres · Supabase Auth.

---

## Checklist

| # | Deliverable | What it is | Link | Status |
|---|---|---|---|---|
| 1 | **README** | Architecture overview, module map, local-start, design tradeoffs — the 5-minute tour | [`../README.md`](../README.md) | ✅ Done |
| 2 | **Architecture doc + diagrams** | Layer contract (queries/actions/route-edges), data model, dual-identity boundary; 3 Mermaid diagrams (request path, ER, dependency fence) | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | ✅ Done |
| 3 | **Network & deployment doc** | Runtime topology, storage config, local-build → SSH ship → restart → health-check process | [`../NETWORK_AND_DEPLOYMENT.md`](../NETWORK_AND_DEPLOYMENT.md) | ✅ Done |
| 4 | **Roadmap** | Spec-audited competition-final plan: honest scorecard, ranked gap table, dynamic-workflow batches | [`../ROADMAP.md`](../ROADMAP.md) | ✅ Done |
| 5 | **API docs (OpenAPI)** | Machine-readable OpenAPI spec for the portable core REST surface (task / annotation / review / export) | [`./api/openapi.yaml`](./api/openapi.yaml) | 🔧 Produced by API task (link only) |
| 6 | **API docs (prose)** | Human-readable companion to the OpenAPI spec — endpoints, auth, examples | [`./api/API.md`](./api/API.md) | 🔧 Produced by API task (link only) |
| 7 | **AI-coding process record** | The real AI-assisted workflow log: spec audits, parallel fan-outs, key decisions | [`./AI_CODING_PROCESS.md`](./AI_CODING_PROCESS.md) | 📄 See file (authored separately) |
| 8 | **Demo video** | 5–10 min end-to-end walk-through across the three roles (Owner / Labeler / Reviewer) | **[飞书妙记 · 演示视频](https://my.feishu.cn/minutes/obcn516fq747f26c73x2albd)** (shot script: [`./demo/SCRIPT.md`](./demo/SCRIPT.md)) | ✅ Recorded 2026-06-10 |
| 9 | **Screenshots** | Designer, AI-agent config, Renderer/answer view, review queue + detail, export | [`./screenshots/`](./screenshots/) (6 frames, captured 2026-06-10 against the live deploy) | ✅ Done (billing/earnings frames skipped — the billing loop is shown in the demo video instead) |
| 10 | **Live demo environment** | The deployed platform, reachable now | **https://aipert.top** | ✅ Live |
| 11 | **Demo-env access doc** | URL + ready-made judge/labeler credentials + a 10-minute tour path + caveats | [`./DEMO_ENV.md`](./DEMO_ENV.md) | ✅ Done |

**Status legend:** ✅ Done · 🔧 Produced by another task in this bundle (this
index only links it) · 📄 Present, see the file itself · 🎬 / 📸 Pending an
interactive/manual capture step.

---

## Supporting material (not a §8 line item, but useful context)

- [`../docs/DEMO.md`](../docs/DEMO.md) — the judge tour: the five hero flows as
  one concrete click-path on a fresh seed (the script the demo video follows).

---

## Suggested judging path (fastest to deepest)

1. Open the **live demo** at **https://aipert.top** and skim
   [`../docs/DEMO.md`](../docs/DEMO.md) to drive the hero flows.
2. Read [`../README.md`](../README.md) for the map, then
   [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §3 (layer contract), §8 (spec →
   implementation map) and §1/§9 (dual-identity boundary).
3. For interface details, read [`./api/API.md`](./api/API.md) alongside
   [`./api/openapi.yaml`](./api/openapi.yaml).
4. For how it ships, read [`../NETWORK_AND_DEPLOYMENT.md`](../NETWORK_AND_DEPLOYMENT.md);
   for direction and known gaps, [`../ROADMAP.md`](../ROADMAP.md).
5. For the build story, read [`./AI_CODING_PROCESS.md`](./AI_CODING_PROCESS.md).

> **Honesty note.** Items 5–9 above are owned by other tasks/people in this
> bundle (the API docs, the process record, and the manually-captured video +
> screenshots). This index links them with their current status rather than
> claiming they are finished; check each artifact's own status badge above.
