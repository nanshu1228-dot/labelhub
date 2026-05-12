import { describe, expect, it } from 'vitest'
import { fold } from './projector'
import { createTaskProjection } from './projections/task-projection'
import { createTrustProjection } from './projections/trust-projection'
import { createTrajectoryEvalProjection } from './projections/trajectory-eval-projection'
import type { EventBase } from './types'

const evt = (overrides: Partial<EventBase>): EventBase => ({
  id: `evt-${Math.random()}`,
  type: 'task.created',
  ts: new Date('2026-01-01T00:00:00Z'),
  actorId: null,
  workspaceId: 'ws1',
  payload: {},
  ...overrides,
})

describe('TaskProjection', () => {
  it('cold start = unknown status, empty counts', () => {
    const state = fold([], createTaskProjection('t1'))
    expect(state.status).toBe('unknown')
    expect(state.topicCounts.drafting).toBe(0)
    expect(state.topicCounts.approved).toBe(0)
  })

  it('task.created sets status=draft and captures name', () => {
    const events = [
      evt({
        type: 'task.created',
        payload: { taskId: 't1', name: 'My Task' },
      }),
    ]
    const state = fold(events, createTaskProjection('t1'))
    expect(state.status).toBe('draft')
    expect(state.taskName).toBe('My Task')
  })

  it('full lifecycle: created → published → topics → approvals → archived', () => {
    const events = [
      evt({ type: 'task.created', payload: { taskId: 't1', name: 'T' } }),
      evt({ type: 'task.published', payload: { taskId: 't1' } }),
      evt({
        type: 'topic.created',
        payload: { taskId: 't1', topicId: 'top1' },
      }),
      evt({
        type: 'topic.created',
        payload: { taskId: 't1', topicId: 'top2' },
      }),
      evt({
        type: 'annotation.submitted',
        payload: { taskId: 't1', topicId: 'top1' },
      }),
      evt({
        type: 'annotation.approved',
        payload: { taskId: 't1', topicId: 'top1' },
      }),
      evt({ type: 'task.archived', payload: { taskId: 't1' } }),
    ]
    const state = fold(events, createTaskProjection('t1'))
    expect(state.status).toBe('archived')
    expect(state.topicCounts.drafting).toBe(1) // top2
    expect(state.topicCounts.approved).toBe(1) // top1
    expect(state.topicCounts.submitted).toBe(0)
  })

  it('ignores events for other tasks', () => {
    const events = [
      evt({
        type: 'task.created',
        payload: { taskId: 'OTHER', name: 'Not me' },
      }),
      evt({
        type: 'topic.created',
        payload: { taskId: 'OTHER', topicId: 't' },
      }),
    ]
    const state = fold(events, createTaskProjection('t1'))
    expect(state.status).toBe('unknown')
    expect(state.topicCounts.drafting).toBe(0)
  })

  it('topic.claimed does not change stage counts', () => {
    const events = [
      evt({
        type: 'topic.created',
        payload: { taskId: 't1', topicId: 'top1' },
      }),
      evt({
        type: 'topic.claimed',
        payload: { taskId: 't1', topicId: 'top1' },
      }),
    ]
    const state = fold(events, createTaskProjection('t1'))
    expect(state.topicCounts.drafting).toBe(1)
  })

  it('annotation.revised → moves topic to revising', () => {
    const events = [
      evt({ type: 'topic.created', payload: { taskId: 't1', topicId: 'tp' } }),
      evt({
        type: 'annotation.submitted',
        payload: { taskId: 't1', topicId: 'tp' },
      }),
      evt({
        type: 'annotation.revised',
        payload: { taskId: 't1', topicId: 'tp' },
      }),
    ]
    const state = fold(events, createTaskProjection('t1'))
    expect(state.topicCounts.revising).toBe(1)
    expect(state.topicCounts.submitted).toBe(0)
  })
})

describe('TrustProjection', () => {
  it('cold start score = 0.5 (Bayesian prior)', () => {
    const state = fold([], createTrustProjection('u1'))
    expect(state.score).toBe(0.5)
    expect(state.totalSubmitted).toBe(0)
  })

  it('only the user\'s submissions count toward totalSubmitted', () => {
    const events = [
      evt({ type: 'annotation.submitted', actorId: 'u1' }),
      evt({ type: 'annotation.submitted', actorId: 'OTHER' }),
      evt({ type: 'annotation.submitted', actorId: 'u1' }),
    ]
    const state = fold(events, createTrustProjection('u1'))
    expect(state.totalSubmitted).toBe(2)
  })

  it('approvals raise score above 0.5', () => {
    const events = Array.from({ length: 10 }, () =>
      evt({
        type: 'annotation.approved',
        payload: { submitterUserId: 'u1' },
      }),
    )
    const state = fold(events, createTrustProjection('u1'))
    expect(state.totalApproved).toBe(10)
    expect(state.score).toBeGreaterThan(0.8)
  })

  it('rejections lower score below 0.5', () => {
    const events = Array.from({ length: 10 }, () =>
      evt({
        type: 'annotation.rejected',
        payload: { submitterUserId: 'u1' },
      }),
    )
    const state = fold(events, createTrustProjection('u1'))
    expect(state.totalRejected).toBe(10)
    expect(state.score).toBeLessThan(0.2)
  })

  it("does NOT count other users' approvals", () => {
    const events = [
      evt({
        type: 'annotation.approved',
        payload: { submitterUserId: 'OTHER' },
      }),
    ]
    const state = fold(events, createTrustProjection('u1'))
    expect(state.totalApproved).toBe(0)
    expect(state.score).toBe(0.5)
  })
})

describe('TrajectoryEvalProjection', () => {
  it('cold start = 0.5, empty timeline', () => {
    const state = fold([], createTrajectoryEvalProjection('task-x'))
    expect(state.accuracyScore).toBe(0.5)
    expect(state.totalApproved).toBe(0)
    expect(state.timeline).toHaveLength(0)
  })

  it('ignores non-agent-trace-eval templateMode', () => {
    const events = [
      evt({
        type: 'annotation.approved',
        payload: {
          taskId: 'task-x',
          templateMode: 'classic-survey',
          annotationPayload: { rubrics: [] },
        },
      }),
    ]
    const state = fold(events, createTrajectoryEvalProjection('task-x'))
    expect(state.totalApproved).toBe(0)
  })

  it('counts optimal+correct as positive', () => {
    const events = [
      evt({
        type: 'annotation.approved',
        payload: {
          taskId: 'task-x',
          templateMode: 'agent-trace-eval',
          annotationPayload: {
            pathChoice: 'optimal',
            finalAnswer: 'correct',
          },
        },
      }),
    ]
    const state = fold(events, createTrajectoryEvalProjection('task-x'))
    expect(state.totalApproved).toBe(1)
    expect(state.totalOptimalAndCorrect).toBe(1)
    expect(state.timeline).toHaveLength(1)
  })

  it('suboptimal+correct does NOT count toward optimalAndCorrect', () => {
    const events = [
      evt({
        type: 'annotation.approved',
        payload: {
          taskId: 'task-x',
          templateMode: 'agent-trace-eval',
          annotationPayload: {
            pathChoice: 'suboptimal',
            finalAnswer: 'correct',
          },
        },
      }),
    ]
    const state = fold(events, createTrajectoryEvalProjection('task-x'))
    expect(state.totalApproved).toBe(1)
    expect(state.totalOptimalAndCorrect).toBe(0)
  })

  it('accuracy converges toward true rate over many approvals', () => {
    // 20 approvals, 18 of them optimal+correct (90% true rate)
    const events = Array.from({ length: 20 }, (_, i) =>
      evt({
        type: 'annotation.approved',
        payload: {
          taskId: 'task-x',
          templateMode: 'agent-trace-eval',
          annotationPayload: {
            pathChoice: i < 18 ? 'optimal' : 'suboptimal',
            finalAnswer: 'correct',
          },
        },
      }),
    )
    const state = fold(events, createTrajectoryEvalProjection('task-x'))
    // With Bayesian prior (α=β=2.5), 18/20 should smooth to roughly (18+2.5)/(20+5) = 0.82
    expect(state.accuracyScore).toBeGreaterThan(0.75)
    expect(state.accuracyScore).toBeLessThan(0.9)
    expect(state.timeline).toHaveLength(20)
  })
})
