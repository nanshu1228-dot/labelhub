/**
 * reset_demo — clear captured trajectories + their steps from the demo workspace.
 *
 * What is removed:
 *   - All `trajectories` and their `trajectory_steps` for workspace 00…010
 *   - `step_annotations` rows pointing at those steps
 *   - `tool_providers` with source='inferred' (declared providers stay so the
 *     seed-script story is undisturbed)
 *
 * What is preserved:
 *   - The workspace, admin user, tasks, topics, gold standards, guidelines
 *   - `tool_providers` with source='declared' (publisher uploads / seed data)
 *   - `workspace_api_keys` (keys are cheap; revoking would orphan local caches)
 *   - `api_request_log` and `events` (audit history is valuable for debugging
 *     even when the captured data is reset; pass --wipe-audit to drop them too)
 *
 * Run: `tsx scripts/debug/reset-demo.ts [--wipe-audit] [--dry-run]`
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { cliRun, isMain, parseArgs } from './_shared/args'
import { withDb, schema } from './_shared/db'
import { DEMO_WORKSPACE_ID } from './_shared/api-key'

export interface ResetDemoArgs {
  wipeAudit?: boolean
  dryRun?: boolean
}

export interface ResetDemoResult {
  workspaceId: string
  dryRun: boolean
  wouldDelete: {
    trajectories: number
    trajectorySteps: number
    stepAnnotations: number
    inferredToolProviders: number
    events: number
    apiRequestLog: number
  }
  deleted: {
    trajectories: number
    trajectorySteps: number
    stepAnnotations: number
    inferredToolProviders: number
    events: number
    apiRequestLog: number
  }
}

export async function runResetDemo(args: ResetDemoArgs): Promise<ResetDemoResult> {
  const dryRun = args.dryRun === true
  const wipeAudit = args.wipeAudit === true

  return withDb(async ({ db }) => {
    // ── Count first (always — used for dry-run + the after-snapshot diff) ─
    const trajIds = await db
      .select({ id: schema.trajectories.id })
      .from(schema.trajectories)
      .where(eq(schema.trajectories.workspaceId, DEMO_WORKSPACE_ID))
    const trajIdList = trajIds.map((r) => r.id)

    const counts = {
      trajectories: trajIdList.length,
      trajectorySteps: 0,
      stepAnnotations: 0,
      inferredToolProviders: 0,
      events: 0,
      apiRequestLog: 0,
    }

    if (trajIdList.length > 0) {
      const [stepCount] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.trajectorySteps)
        .where(inArray(schema.trajectorySteps.trajectoryId, trajIdList))
      counts.trajectorySteps = Number(stepCount?.n ?? 0)

      const [annCount] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.stepAnnotations)
        .innerJoin(
          schema.trajectorySteps,
          eq(schema.stepAnnotations.trajectoryStepId, schema.trajectorySteps.id),
        )
        .where(inArray(schema.trajectorySteps.trajectoryId, trajIdList))
      counts.stepAnnotations = Number(annCount?.n ?? 0)
    }

    const [tpCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.toolProviders)
      .where(
        and(
          eq(schema.toolProviders.workspaceId, DEMO_WORKSPACE_ID),
          eq(schema.toolProviders.source, 'inferred'),
        ),
      )
    counts.inferredToolProviders = Number(tpCount?.n ?? 0)

    if (wipeAudit) {
      const [ev] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.events)
        .where(eq(schema.events.workspaceId, DEMO_WORKSPACE_ID))
      counts.events = Number(ev?.n ?? 0)

      const [audit] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.apiRequestLog)
        .where(eq(schema.apiRequestLog.workspaceId, DEMO_WORKSPACE_ID))
      counts.apiRequestLog = Number(audit?.n ?? 0)
    }

    if (dryRun) {
      return {
        workspaceId: DEMO_WORKSPACE_ID,
        dryRun: true,
        wouldDelete: counts,
        deleted: {
          trajectories: 0,
          trajectorySteps: 0,
          stepAnnotations: 0,
          inferredToolProviders: 0,
          events: 0,
          apiRequestLog: 0,
        },
      }
    }

    // ── Delete in FK-safe order ──────────────────────────────────────────
    if (trajIdList.length > 0) {
      // step_annotations → trajectory_steps → trajectories
      await db.execute(sql`
        delete from ${schema.stepAnnotations}
        where ${schema.stepAnnotations.trajectoryStepId} in (
          select ${schema.trajectorySteps.id}
          from ${schema.trajectorySteps}
          where ${schema.trajectorySteps.trajectoryId} = any(${trajIdList}::uuid[])
        )
      `)

      await db
        .delete(schema.trajectorySteps)
        .where(inArray(schema.trajectorySteps.trajectoryId, trajIdList))

      await db
        .delete(schema.trajectories)
        .where(eq(schema.trajectories.workspaceId, DEMO_WORKSPACE_ID))
    }

    // Inferred providers — declared ones are part of the seed contract.
    await db
      .delete(schema.toolProviders)
      .where(
        and(
          eq(schema.toolProviders.workspaceId, DEMO_WORKSPACE_ID),
          eq(schema.toolProviders.source, 'inferred'),
        ),
      )

    if (wipeAudit) {
      await db
        .delete(schema.events)
        .where(eq(schema.events.workspaceId, DEMO_WORKSPACE_ID))
      await db
        .delete(schema.apiRequestLog)
        .where(eq(schema.apiRequestLog.workspaceId, DEMO_WORKSPACE_ID))
    }

    return {
      workspaceId: DEMO_WORKSPACE_ID,
      dryRun: false,
      wouldDelete: counts,
      deleted: counts,
    }
  })
}

if (isMain(import.meta.url)) {
  void cliRun(async () => {
    const a = parseArgs(process.argv.slice(2))
    return runResetDemo({
      wipeAudit: a['wipe-audit'] === true || a.wipeAudit === true,
      dryRun: a['dry-run'] === true || a.dryRun === true,
    })
  })
}
