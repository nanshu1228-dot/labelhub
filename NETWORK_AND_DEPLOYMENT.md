# Network & Deployment

How LabelHub runs in production. Companion to `ARCHITECTURE.md` (which covers
the code); this file covers the runtime topology, storage configuration, and
the ship process.

> No secrets live in this repo or this doc. SSH host/key details are read at
> deploy time from a `.deploy.env` file kept **outside** the source tree;
> application secrets live in `/etc/labelhub.env` on the server only.

---

## 1. Runtime topology

```
Browser ──HTTPS──> nginx (TLS, reverse proxy) ──> Next.js standalone server
                                                     │  (systemd unit: labelhub)
                                                     ├─> Supabase  (Auth + Postgres)
                                                     └─> local disk (uploads / exports)
```

- **App**: a Next.js **standalone** server (`output: 'standalone'` in
  `next.config.ts`) run as the `labelhub` systemd service, listening on a
  local port that nginx reverse-proxies. Production origin: `https://aipert.top`.
- **Auth + DB**: Supabase (cookie sessions via `@supabase/ssr`; Postgres via
  the `postgres` driver behind `getDb()`).
- **File storage**: the **local** storage driver (see §3) — uploads and export
  artifacts are written to a disk path, not object storage. Chosen for a small
  single-VPS deployment; swappable behind `src/lib/storage`.

---

## 2. Storage configuration

The storage layer (`src/lib/storage`, `src/lib/export/storage.ts`) is driver-
based. Production uses the local-disk driver:

| Env var | Meaning |
|---|---|
| `STORAGE_DRIVER` | `local` (the only production driver today). |
| `LOCAL_STORAGE_DIR` | Absolute path where uploads/exports are written. |
| `LOCAL_STORAGE_BASE_URL` | Public base URL nginx maps onto that dir for downloads. |

Keeping storage local (rather than Supabase Storage) was a deliberate choice
for the small domestic VPS; the driver seam means moving to object storage is
an additive change, not a rewrite.

---

## 3. Other production env

Set in `/etc/labelhub.env` on the server (names only — never commit values):

- `DATABASE_URL` — Postgres connection string.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — baked into the
  browser bundle at **build** time (the ship script hydrates these from the
  server before building).
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` — server-only secrets.
- `LABELHUB_FOCUS_MODE` (default on; see `ARCHITECTURE.md` §5),
  `LABELHUB_DEMO_MODE`, and the storage vars above.

---

## 4. Ship process — `deploy/build-and-ship.sh`

Because the VPS is too small to run `next build`, the bundle is built locally
and shipped:

1. **Build locally** — hydrate `NEXT_PUBLIC_*` from the server's
   `/etc/labelhub.env`, then `npm run build` to produce `.next/standalone`
   (~30 MB, self-contained — the VPS needs no `npm install`).
2. **Ship over SSH** — upload the standalone bundle + `public/` + `.next/static/`.
   The current release is moved to `code.prev` first, so a bad deploy can be
   rolled back by swapping it back.
3. **Restart** — `systemctl restart labelhub`.
4. **Health check** — `curl https://aipert.top/api/health` expects `200`.

No database migration runs as part of a normal deploy; schema changes are
applied explicitly via `npm run db:push` (Drizzle).
