/**
 * Create some inter-annotator disagreement in the demo workspace so the
 * "disputed steps" UI has something to show.
 *
 * Strategy:
 *   1. Ensure a second demo user exists (DEMO_REVIEWER_ID, …002)
 *   2. For each existing topic with marks from the admin, mint an
 *      annotation row for the reviewer
 *   3. Insert step_annotations from the reviewer with DIFFERENT ratings on
 *      ~half of the steps the admin rated — that's our disagreement signal
 *
 * Idempotent: re-running doesn't duplicate rows.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { and, eq, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
const ADMIN_ID = '00000000-0000-0000-0000-000000000001'
const REVIEWER_ID = '00000000-0000-0000-0000-000000000002'

/** Pick a DIFFERENT rating from what admin chose: 5↔1, 3 flips to 1, etc. */
function disagreeWith(rating: number): number {
  if (rating === 5) return 3
  if (rating === 3) return 1
  if (rating === 1) return 5
  return rating === 5 ? 3 : 5
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  const db = drizzle(sql, { schema })

  // 1. Ensure reviewer user
  await db
    .insert(schema.users)
    .values({
      id: REVIEWER_ID,
      email: 'demo-reviewer@labelhub.local',
      displayName: 'Demo Reviewer',
    })
    .onConflictDoNothing()
  console.log(`✓ reviewer user ensured (${REVIEWER_ID.slice(0, 8)}…)`)

  // 2. Find every annotation in this workspace that the ADMIN owns
  // (joined through topics → tasks → workspaces).
  const adminAnnotations = await db
    .select({
      id: schema.annotations.id,
      topicId: schema.annotations.topicId,
      taskId: schema.topics.taskId,
      workspaceId: schema.tasks.workspaceId,
    })
    .from(schema.annotations)
    .innerJoin(schema.topics, eq(schema.annotations.topicId, schema.topics.id))
    .innerJoin(schema.tasks, eq(schema.topics.taskId, schema.tasks.id))
    .where(
      and(
        eq(schema.annotations.userId, ADMIN_ID),
        eq(schema.tasks.workspaceId, WORKSPACE_ID),
      ),
    )
  console.log(`  found ${adminAnnotations.length} admin annotation row(s)`)

  let stepsDisputed = 0
  for (const adminAnn of adminAnnotations) {
    // 3. For each, ensure the reviewer has their own annotation row on the
    //    same topic.
    let [reviewerAnn] = await db
      .select()
      .from(schema.annotations)
      .where(
        and(
          eq(schema.annotations.topicId, adminAnn.topicId),
          eq(schema.annotations.userId, REVIEWER_ID),
        ),
      )
      .limit(1)
    if (!reviewerAnn) {
      ;[reviewerAnn] = await db
        .insert(schema.annotations)
        .values({
          topicId: adminAnn.topicId,
          userId: REVIEWER_ID,
          payload: {},
        })
        .returning()
    }

    // 4. Find the admin's step_annotations for this annotation
    const adminMarks = await db
      .select()
      .from(schema.stepAnnotations)
      .where(eq(schema.stepAnnotations.annotationId, adminAnn.id))

    for (const m of adminMarks) {
      // Skip if reviewer already rated this step
      const existing = await db
        .select({ id: schema.stepAnnotations.id })
        .from(schema.stepAnnotations)
        .where(
          and(
            eq(schema.stepAnnotations.annotationId, reviewerAnn.id),
            eq(schema.stepAnnotations.trajectoryStepId, m.trajectoryStepId),
            eq(schema.stepAnnotations.kind, m.kind),
          ),
        )
        .limit(1)
      if (existing[0]) continue

      const disputed = disagreeWith(m.rating ?? 3)
      await db.insert(schema.stepAnnotations).values({
        annotationId: reviewerAnn.id,
        trajectoryStepId: m.trajectoryStepId,
        kind: m.kind,
        rating: disputed,
        reasoning: `Reviewer disagrees: I think this should be rated ${disputed === 5 ? '"correct"' : disputed === 3 ? '"suspicious"' : '"wrong"'} because the model's choice was ${disputed === 5 ? 'well-reasoned' : disputed === 3 ? 'plausible but not best' : 'a real mistake'}.`,
      })
      stepsDisputed++

      // Audit event so the projection can pick it up later
      await db.insert(schema.events).values({
        type: 'step_annotation.created',
        workspaceId: WORKSPACE_ID,
        actorId: REVIEWER_ID,
        payload: {
          annotationId: reviewerAnn.id,
          trajectoryStepId: m.trajectoryStepId,
          kind: m.kind,
          rating: disputed,
          demo: true,
          seededDisagreement: true,
        },
      })
    }
  }

  console.log(
    `\n✓ seeded ${stepsDisputed} disputed step annotations across ${adminAnnotations.length} annotation row(s)`,
  )

  void ne // keep import
  await sql.end()
}
main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
