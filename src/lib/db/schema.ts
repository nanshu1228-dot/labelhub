/**
 * LabelHub schema — full Day 2 design.
 *
 * Data model adopted from ByteDance Xpert (proven by the largest player in the space):
 *   workspace → tasks → topics → annotations
 *
 * Plus our additions:
 *   - events (Pillar 2: event sourcing)
 *   - gold_standards (for trust score calibration)
 *   - trust_scores (per user × task type)
 *   - guidelines + guideline_patches (Living Guidelines)
 *
 * Optimistic concurrency: rows that can be edited by multiple actors carry a `version`
 * column. Updates use `WHERE id = ? AND version = ?` then bump version.
 *
 * ── Barrel ─────────────────────────────────────────────────────────────
 * The schema has been split into domain modules under `./schema/`. This
 * file remains the single import surface (`@/lib/db/schema`) and the
 * drizzle.config.ts entry point, re-exporting every table, enum, and
 * relation from the modules below.
 */
export * from './schema/enums'
export * from './schema/core'
export * from './schema/proxy'
export * from './schema/trajectories'
export * from './schema/billing'
export * from './schema/judges'
export * from './schema/consensus'
