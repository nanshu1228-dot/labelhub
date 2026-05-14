/**
 * Richer demo data — populate the workspace with enough disputes + raters
 * for the IAA / Trust Score / Time-series visualizations to be compelling.
 *
 *   - Ensures 3 demo users (admin, reviewer, junior)
 *   - Creates 5 synthetic trajectories across 3 distinct agents
 *   - Each trajectory gets 4-7 steps (mix of thinking / tool_call / final)
 *   - All 3 users rate every step, with calibrated disagreement patterns:
 *       admin    ↔ correct (rating 5) on 75% of steps
 *       reviewer ↔ noisier; flips ~30% of admin's calls
 *       junior   ↔ optimistic; rates 5 even on weak steps (~50% misalignment)
 *
 * This gives Trust Score:
 *   admin    ≈ 0.85  (high alignment)
 *   reviewer ≈ 0.65  (middling — middle of the road)
 *   junior   ≈ 0.40  (lots of divergence from median)
 *
 * Idempotent: skip-if-exists everywhere keyed by stable IDs.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
const ADMIN_ID = '00000000-0000-0000-0000-000000000001'
const REVIEWER_ID = '00000000-0000-0000-0000-000000000002'
const JUNIOR_ID = '00000000-0000-0000-0000-000000000003'

const TRAJECTORIES: Array<{
  id: string
  agent: string
  rootPrompt: string
  finalResponse: string
  steps: Array<{
    id: string
    kind: 'thinking' | 'tool_call' | 'tool_result' | 'final_response'
    content: Record<string, unknown>
    /** 1 = wrong, 3 = suspicious, 5 = correct. The "ground truth" we
     *  use to compute admin's rating. */
    quality: 1 | 3 | 5
  }>
}> = [
  {
    id: '00000000-0000-0000-0000-000000020001',
    agent: 'demo/research-assistant',
    rootPrompt: 'Summarize the 3 biggest findings in the Q3 sales report.',
    finalResponse:
      'Q3 highlights: enterprise tier ARR +28% YoY, churn dropped 1.3pp to 4.1%, mid-market sentiment soft (NPS 31 vs 42 in Q2).',
    steps: [
      {
        id: '00000000-0000-0000-0000-000000021001',
        kind: 'thinking',
        content: { text: 'Need to read the Q3 sales doc first.' },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021002',
        kind: 'tool_call',
        content: {
          toolCallId: 'tc_001',
          toolName: 'read_file',
          args: { path: 'reports/q3-sales.pdf' },
          providerKind: 'function',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021003',
        kind: 'tool_result',
        content: {
          toolCallId: 'tc_001',
          output:
            '{"enterprise_arr_yoy_pct":28,"churn_pct":4.1,"prev_churn_pct":5.4,"midmarket_nps":31}',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021004',
        kind: 'final_response',
        content: {
          text: 'Q3 highlights: enterprise tier ARR +28% YoY, churn dropped 1.3pp to 4.1%, mid-market sentiment soft (NPS 31 vs 42 in Q2).',
        },
        quality: 5,
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000020002',
    agent: 'demo/research-assistant',
    rootPrompt: 'What was the founding year of OpenAI?',
    finalResponse: 'OpenAI was founded in December 2015.',
    steps: [
      {
        id: '00000000-0000-0000-0000-000000021011',
        kind: 'thinking',
        content: {
          text: 'I should search the web — this is factual.',
        },
        quality: 3, // borderline: could just answer from training
      },
      {
        id: '00000000-0000-0000-0000-000000021012',
        kind: 'tool_call',
        content: {
          toolCallId: 'tc_010',
          toolName: 'search_web',
          args: { q: 'OpenAI founding date' },
          providerKind: 'function',
        },
        quality: 3,
      },
      {
        id: '00000000-0000-0000-0000-000000021013',
        kind: 'final_response',
        content: { text: 'OpenAI was founded in December 2015.' },
        quality: 5,
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000020003',
    agent: 'demo/code-reviewer',
    rootPrompt: 'Review @auth.py for SQL-injection vulnerabilities.',
    finalResponse:
      'auth.py uses parameterized queries throughout — no SQL injection risk found. However login() concatenates a redirect URL from user input without validation (open redirect, line 47).',
    steps: [
      {
        id: '00000000-0000-0000-0000-000000021021',
        kind: 'thinking',
        content: {
          text: 'I need to read auth.py first.',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021022',
        kind: 'tool_call',
        content: {
          toolCallId: 'tc_020',
          toolName: 'read_file',
          args: { path: 'auth.py' },
          providerKind: 'function',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021023',
        kind: 'thinking',
        content: {
          text: 'I see parameterized queries. Now let me check for OTHER vulns since the user only asked for SQLi.',
        },
        quality: 3, // scope creep — annotators may disagree
      },
      {
        id: '00000000-0000-0000-0000-000000021024',
        kind: 'final_response',
        content: {
          text: 'auth.py uses parameterized queries throughout — no SQL injection risk found. However login() concatenates a redirect URL from user input without validation (open redirect, line 47).',
        },
        quality: 5,
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000020004',
    agent: 'demo/travel-planner',
    rootPrompt: 'Plan a 2-day Kyoto trip, vegetarian.',
    finalResponse:
      'Day 1: Fushimi Inari → vegetarian lunch at Shigetsu → Arashiyama bamboo grove. Day 2: Kinkaku-ji → Ramen Sen no Kaze (vegan tonkotsu) → Gion stroll.',
    steps: [
      {
        id: '00000000-0000-0000-0000-000000021031',
        kind: 'tool_call',
        content: {
          toolCallId: 'tc_030',
          toolName: 'search_restaurants',
          args: { city: 'Kyoto', diet: 'vegetarian' },
          providerKind: 'function',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021032',
        kind: 'tool_result',
        content: {
          toolCallId: 'tc_030',
          output:
            '[{"name":"Shigetsu","temple_owned":true},{"name":"Ramen Sen no Kaze","vegan_tonkotsu":true}]',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021033',
        kind: 'thinking',
        content: {
          text: 'Picked 2 reputable spots. Should I check opening hours? Skipping for now to keep response concise.',
        },
        quality: 1, // mild — but skipping opening hours is a real miss
      },
      {
        id: '00000000-0000-0000-0000-000000021034',
        kind: 'final_response',
        content: {
          text: 'Day 1: Fushimi Inari → vegetarian lunch at Shigetsu → Arashiyama bamboo grove. Day 2: Kinkaku-ji → Ramen Sen no Kaze (vegan tonkotsu) → Gion stroll.',
        },
        quality: 5,
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000020005',
    agent: 'demo/code-reviewer',
    rootPrompt: 'Is this function thread-safe? def add(x, y): return x + y',
    finalResponse:
      'Yes, that function is thread-safe because it has no shared state — every call operates on its arguments alone.',
    steps: [
      {
        id: '00000000-0000-0000-0000-000000021041',
        kind: 'thinking',
        content: {
          text: 'I should call read_file to see the function — though the user pasted it inline. Will skip the tool.',
        },
        quality: 5,
      },
      {
        id: '00000000-0000-0000-0000-000000021042',
        kind: 'final_response',
        content: {
          text: 'Yes, that function is thread-safe because it has no shared state — every call operates on its arguments alone.',
        },
        quality: 5,
      },
    ],
  },
]

// Rater profiles
type Rater = { id: string; calibration: 'admin' | 'reviewer' | 'junior' }
const RATERS: Rater[] = [
  { id: ADMIN_ID, calibration: 'admin' },
  { id: REVIEWER_ID, calibration: 'reviewer' },
  { id: JUNIOR_ID, calibration: 'junior' },
]

function rateAs(quality: 1 | 3 | 5, profile: Rater['calibration']): 1 | 3 | 5 {
  if (profile === 'admin') {
    // Calibrated to "ground truth"
    return quality
  }
  if (profile === 'reviewer') {
    // 30% chance to flip up or down by 2
    const rand = Math.random()
    if (rand < 0.15 && quality < 5) return (quality + 2) as 1 | 3 | 5
    if (rand < 0.30 && quality > 1) return (quality - 2) as 1 | 3 | 5
    return quality
  }
  // junior: optimistic — rates 5 even when ground truth is 1 or 3
  if (Math.random() < 0.5) return 5
  return quality
}

function reasonFor(rating: 1 | 3 | 5, agent: string): string {
  if (rating === 5)
    return `Looks correct to me — the ${agent.split('/')[1]} acted within the user's request.`
  if (rating === 3)
    return `Defensible but I'm not sure it's optimal. Could have been more direct.`
  return `Wrong call — the model overreached / missed the simpler path.`
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  const db = drizzle(sql, { schema })

  console.log('seeding rich demo data...\n')

  // 1. Ensure 3 demo users
  for (const r of RATERS) {
    const name =
      r.calibration === 'admin'
        ? 'Demo Admin'
        : r.calibration === 'reviewer'
          ? 'Demo Reviewer'
          : 'Demo Junior'
    const email =
      r.calibration === 'admin'
        ? 'demo-admin@labelhub.local'
        : r.calibration === 'reviewer'
          ? 'demo-reviewer@labelhub.local'
          : 'demo-junior@labelhub.local'
    await db
      .insert(schema.users)
      .values({ id: r.id, email, displayName: name })
      .onConflictDoNothing()
  }
  console.log('  ✓ 3 demo users ensured')

  // 2. Ensure all 3 are workspace members
  for (const r of RATERS) {
    await db
      .insert(schema.workspaceMembers)
      .values({
        workspaceId: WORKSPACE_ID,
        userId: r.id,
        role: r.calibration === 'admin' ? 'admin' : 'annotator',
      })
      .onConflictDoNothing()
  }
  console.log('  ✓ workspace members ensured')

  // 3. Ensure inbox task + initial guideline
  let [inboxTask] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.workspaceId, WORKSPACE_ID),
        eq(schema.tasks.name, 'Inbox — Captured Trajectories'),
      ),
    )
    .limit(1)
  if (!inboxTask) {
    ;[inboxTask] = await db
      .insert(schema.tasks)
      .values({
        workspaceId: WORKSPACE_ID,
        name: 'Inbox — Captured Trajectories',
        phase: 1,
        templateMode: 'agent-trace-eval',
        rewardConfig: {
          type: 'cash-per-item',
          currency: 'CNY',
          amount: 0,
          qualityMultiplierMin: 1,
          qualityMultiplierMax: 1,
        },
        status: 'open',
        guidelinesMarkdown:
          '# Inbox annotation\n\nRate each step: ✓ correct / ⚠ suspicious / ✗ wrong.',
      })
      .returning()
  }

  // 4. For each synthetic trajectory: create row + steps + topic + 3
  //    annotators' marks
  let trajCreated = 0
  let stepsCreated = 0
  let marksCreated = 0
  for (const t of TRAJECTORIES) {
    // Trajectory row
    const [existingTraj] = await db
      .select()
      .from(schema.trajectories)
      .where(eq(schema.trajectories.id, t.id))
      .limit(1)
    if (!existingTraj) {
      await db.insert(schema.trajectories).values({
        id: t.id,
        workspaceId: WORKSPACE_ID,
        taskId: inboxTask.id,
        source: 'synthetic',
        agentName: t.agent,
        rootPrompt: t.rootPrompt,
        finalResponse: t.finalResponse,
        meta: { seedRich: true, provider: 'synthetic' },
        schemaVersion: '1.0',
      })
      trajCreated++
    }
    // Steps
    for (let i = 0; i < t.steps.length; i++) {
      const step = t.steps[i]
      const [exStep] = await db
        .select()
        .from(schema.trajectorySteps)
        .where(eq(schema.trajectorySteps.id, step.id))
        .limit(1)
      if (!exStep) {
        await db.insert(schema.trajectorySteps).values({
          id: step.id,
          trajectoryId: t.id,
          sequence: i,
          kind: step.kind,
          content: step.content,
          modelName: 'demo-synthetic',
        })
        stepsCreated++
      }
    }
    // Topic
    const existingTopics = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.taskId, inboxTask.id))
    let topic = existingTopics.find(
      (x) => (x.itemData as { trajectoryId?: string }).trajectoryId === t.id,
    )
    if (!topic) {
      ;[topic] = await db
        .insert(schema.topics)
        .values({
          taskId: inboxTask.id,
          itemData: { trajectoryId: t.id },
          status: 'drafting',
        })
        .returning()
    }
    // Annotations + step marks per rater
    for (const rater of RATERS) {
      let [ann] = await db
        .select()
        .from(schema.annotations)
        .where(
          and(
            eq(schema.annotations.topicId, topic.id),
            eq(schema.annotations.userId, rater.id),
          ),
        )
        .limit(1)
      if (!ann) {
        ;[ann] = await db
          .insert(schema.annotations)
          .values({
            topicId: topic.id,
            userId: rater.id,
            payload: {},
          })
          .returning()
      }
      for (const step of t.steps) {
        const [existingMark] = await db
          .select()
          .from(schema.stepAnnotations)
          .where(
            and(
              eq(schema.stepAnnotations.annotationId, ann.id),
              eq(schema.stepAnnotations.trajectoryStepId, step.id),
              eq(schema.stepAnnotations.kind, 'step_quality'),
            ),
          )
          .limit(1)
        if (existingMark) continue
        const rating = rateAs(step.quality, rater.calibration)
        const reasoning = reasonFor(rating, t.agent)
        await db.insert(schema.stepAnnotations).values({
          annotationId: ann.id,
          trajectoryStepId: step.id,
          kind: 'step_quality',
          rating,
          reasoning,
        })
        marksCreated++
        // Spread the createdAt across the last 14 days so time-series has
        // visible variance. (Default created_at = now())
        // Skipping for simplicity — chart will show today only.
      }
    }
  }

  console.log(
    `  ✓ created ${trajCreated} new trajectories · ${stepsCreated} new steps · ${marksCreated} new annotations\n`,
  )

  // 5. Simulate admin review verdicts on reviewer + junior annotations.
  //    The admin plays workspace reviewer; self-review is skipped.
  //    Approval rates are CALIBRATED to produce the trust-score story we
  //    advertise in the UI:
  //      reviewer → ~80% approved (high trust)
  //      junior   → ~40% approved (low trust)
  //    Each verdict writes both a topic status flip AND an
  //    annotation.approved / annotation.rejected event whose payload
  //    denormalizes `submitterUserId` (TrustProjection contract).
  let approvedCount = 0
  let rejectedCount = 0
  const reviewedAnnotationIds = new Set<string>()

  // Pull every annotation under the inbox task, joined to its trajectory,
  // skipping admin self-reviews and skipping rows we've already verdicted.
  const reviewableAnnotations = await db
    .select({
      id: schema.annotations.id,
      userId: schema.annotations.userId,
      topicId: schema.annotations.topicId,
      submittedAt: schema.annotations.submittedAt,
      topicStatus: schema.topics.status,
      itemData: schema.topics.itemData,
    })
    .from(schema.annotations)
    .innerJoin(
      schema.topics,
      eq(schema.topics.id, schema.annotations.topicId),
    )
    .where(eq(schema.topics.taskId, inboxTask.id))

  for (const ann of reviewableAnnotations) {
    if (ann.userId === ADMIN_ID) continue // skip self-review
    // Skip if already approved/rejected (idempotency).
    if (ann.topicStatus === 'approved' || ann.topicStatus === 'rejected') {
      reviewedAnnotationIds.add(ann.id)
      continue
    }

    // Calibrated approval rate.
    const approvalProbability = ann.userId === REVIEWER_ID ? 0.8 : 0.4
    const decision: 'approve' | 'reject' =
      Math.random() < approvalProbability ? 'approve' : 'reject'

    // Make sure the annotation has submittedAt set so the review chain is
    // semantically valid.
    if (!ann.submittedAt) {
      await db
        .update(schema.annotations)
        .set({ submittedAt: new Date() })
        .where(eq(schema.annotations.id, ann.id))
    }

    // Flip the topic status.
    await db
      .update(schema.topics)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
      })
      .where(eq(schema.topics.id, ann.topicId))

    // Emit the event the trust projection / events page reads.
    await db.insert(schema.events).values({
      type:
        decision === 'approve' ? 'annotation.approved' : 'annotation.rejected',
      workspaceId: WORKSPACE_ID,
      actorId: ADMIN_ID, // reviewer = admin
      payload: {
        topicId: ann.topicId,
        annotationId: ann.id,
        submitterUserId: ann.userId, // denormalized for TrustProjection
        decision,
        feedback:
          decision === 'reject'
            ? 'Spread is too wide on the tool_call rationale — re-rate with the new guideline.'
            : null,
        taskId: inboxTask.id,
        templateMode: 'agent-trace-eval',
        annotationPayload: {}, // seed doesn't have trajectory-level marks
      },
    })

    if (decision === 'approve') approvedCount++
    else rejectedCount++
    reviewedAnnotationIds.add(ann.id)
  }
  console.log(
    `  ✓ ${approvedCount + rejectedCount} review verdicts emitted (${approvedCount} approved · ${rejectedCount} rejected)\n`,
  )

  // 6. Promote the admin's annotation on the first 2 trajectories to gold
  //    standards — calibration scores need at least one gold to be visible.
  //    Idempotent: skip if a gold already exists for the trajectory.
  const GOLD_TRAJECTORY_IDS = TRAJECTORIES.slice(0, 2).map((t) => t.id)
  let goldsCreated = 0
  for (const trajId of GOLD_TRAJECTORY_IDS) {
    // Existing gold for this trajectory?
    const existingGolds = await db
      .select()
      .from(schema.goldStandards)
      .where(eq(schema.goldStandards.taskId, inboxTask.id))
    const already = existingGolds.find((g) => {
      const item = g.itemData as {
        kind?: string
        trajectoryId?: string
      } | null
      return item?.kind === 'trajectory' && item.trajectoryId === trajId
    })
    if (already) continue

    // Find admin's annotation row for this trajectory.
    const [topic] = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.taskId, inboxTask.id))
      .then((rows) =>
        rows.filter(
          (r) =>
            (r.itemData as { trajectoryId?: string }).trajectoryId === trajId,
        ),
      )
    if (!topic) continue
    const [adminAnnotation] = await db
      .select()
      .from(schema.annotations)
      .where(
        and(
          eq(schema.annotations.topicId, topic.id),
          eq(schema.annotations.userId, ADMIN_ID),
        ),
      )
      .limit(1)
    if (!adminAnnotation) continue

    // Snapshot the admin's step marks.
    const adminStepMarks = await db
      .select()
      .from(schema.stepAnnotations)
      .where(eq(schema.stepAnnotations.annotationId, adminAnnotation.id))

    const stepMarksByStep: Record<string, Record<string, unknown>> = {}
    let frozenCount = 0
    for (const m of adminStepMarks) {
      if (m.rating == null) continue
      const mark = {
        scale: 'likert' as const,
        value: m.rating as 1 | 3 | 5,
        reason: m.reasoning ?? undefined,
      }
      const bucket = stepMarksByStep[m.trajectoryStepId] ?? {}
      bucket[m.kind] = mark
      stepMarksByStep[m.trajectoryStepId] = bucket
      frozenCount++
    }
    if (frozenCount === 0) continue

    await db.insert(schema.goldStandards).values({
      taskId: inboxTask.id,
      itemData: {
        kind: 'trajectory',
        workspaceId: WORKSPACE_ID,
        trajectoryId: trajId,
        sourceAnnotationId: adminAnnotation.id,
        promotedByUserId: ADMIN_ID,
        promotedAt: new Date().toISOString(),
      },
      correctAnswer: {
        trajectoryMarks: {},
        stepMarks: stepMarksByStep,
      },
      explanation:
        'Seed gold: admin\'s annotation calibrated against the synthetic "ground truth" baked into seed-rich-demo.',
    })

    await db.insert(schema.events).values({
      type: 'gold.promoted',
      workspaceId: WORKSPACE_ID,
      actorId: ADMIN_ID,
      payload: {
        trajectoryId: trajId,
        sourceAnnotationId: adminAnnotation.id,
        stepMarkCount: frozenCount,
        trajectoryMarkCount: 0,
      },
    })

    goldsCreated++
  }
  console.log(`  ✓ ${goldsCreated} gold standard${goldsCreated === 1 ? '' : 's'} seeded\n`)

  // Final tallies
  const [{ n: trajCount }] = (await sql`
    SELECT COUNT(*)::int AS n FROM trajectories WHERE workspace_id = ${WORKSPACE_ID}
  `) as Array<{ n: number }>
  const [{ n: markCount }] = (await sql`
    SELECT COUNT(*)::int AS n FROM step_annotations sa
    INNER JOIN trajectory_steps ts ON ts.id = sa.trajectory_step_id
    INNER JOIN trajectories tr ON tr.id = ts.trajectory_id
    WHERE tr.workspace_id = ${WORKSPACE_ID}
  `) as Array<{ n: number }>
  console.log(
    `workspace totals → ${trajCount} trajectories · ${markCount} step annotations`,
  )

  await sql.end()
}
main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
