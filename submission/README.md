# `submission/` — how to read this bundle

This directory consolidates everything a judge needs to evaluate **LabelHub**
against the assignment's §8 deliverables. It is a thin layer: the substantive
documentation already lives at the repository root (`../README.md`,
`../ARCHITECTURE.md`, etc.); this folder gathers the submission-specific
artifacts (API docs, process record, demo media) and an index that ties it all
together.

**Start with [`INDEX.md`](./INDEX.md)** — it is the judge's entry point: a
checklist that links every §8 deliverable with one line and an honest status.

**Live demo:** **https://aipert.top**

---

## Layout

```
submission/
├── INDEX.md              ← START HERE: checklist + links to every §8 deliverable
├── README.md             ← this file (how to navigate the bundle)
├── api/
│   ├── openapi.yaml       portable OpenAPI spec for the core REST surface
│   └── API.md             prose companion to the OpenAPI spec
├── AI_CODING_PROCESS.md   the AI-assisted development workflow record
├── demo/                  5–10 min end-to-end demo video
└── screenshots/           key-screen captures (Designer, review, export, …)
```

Root-level docs the index links back to (not duplicated here):
`../README.md`, `../ARCHITECTURE.md`, `../NETWORK_AND_DEPLOYMENT.md`,
`../ROADMAP.md`, and the judge tour `../docs/DEMO.md`.

---

## How a judge should navigate

1. **Open [`INDEX.md`](./INDEX.md).** It maps each §8 deliverable to its file
   with an honest status badge, plus a suggested fastest-to-deepest reading
   path.
2. **Try the live site** at **https://aipert.top**, driving the flows in
   `../docs/DEMO.md`.
3. **Drill in** via the root architecture docs and this folder's `api/`,
   `AI_CODING_PROCESS.md`, `demo/`, and `screenshots/` as the index directs.

---

## A note on completeness

This bundle is assembled from several tasks. The two files in *this* commit are
`INDEX.md` and this `README.md`. The other artifacts —
`api/` (OpenAPI + prose), `AI_CODING_PROCESS.md`, `demo/`, and `screenshots/` —
are produced by separate tasks/people; the demo video and screenshots in
particular require a running app and are captured after the polish work lands.
`INDEX.md` reflects each artifact's real, current status rather than assuming
it is finished — check the badges there before relying on any single item.
