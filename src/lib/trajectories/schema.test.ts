import { describe, expect, it } from 'vitest'
import { validateTrajectory, canonicalTrajectorySchema } from './schema'

describe('Canonical Trajectory Schema', () => {
  const validMinimal = {
    agentName: 'a',
    rootPrompt: 'hello',
    source: 'upload',
    schemaVersion: '1.0',
    steps: [
      { sequence: 0, kind: 'thinking', content: { text: 'thinking...' } },
    ],
  }

  it('accepts a valid minimal trajectory', () => {
    expect(() => validateTrajectory(validMinimal)).not.toThrow()
  })

  it('REJECTS missing required fields', () => {
    expect(() => validateTrajectory({})).toThrow()
    expect(() =>
      validateTrajectory({ agentName: 'a' }),
    ).toThrow()
    expect(() =>
      validateTrajectory({
        agentName: 'a',
        rootPrompt: 'p',
        source: 'upload',
      }),
    ).toThrow(/steps/)
  })

  it('REJECTS invalid step kind', () => {
    expect(() =>
      validateTrajectory({
        ...validMinimal,
        steps: [{ sequence: 0, kind: 'made_up_kind', content: {} }],
      }),
    ).toThrow()
  })

  it('REJECTS invalid source enum', () => {
    expect(() =>
      validateTrajectory({ ...validMinimal, source: 'pirated' }),
    ).toThrow()
  })

  it('VALIDATES kind-specific content: tool_call needs toolCallId + toolName', () => {
    // Missing toolName
    expect(() =>
      validateTrajectory({
        ...validMinimal,
        steps: [
          {
            sequence: 0,
            kind: 'tool_call',
            content: { toolCallId: 'tc1' },
          },
        ],
      }),
    ).toThrow()
    // Missing toolCallId
    expect(() =>
      validateTrajectory({
        ...validMinimal,
        steps: [
          {
            sequence: 0,
            kind: 'tool_call',
            content: { toolName: 'foo' },
          },
        ],
      }),
    ).toThrow()
    // Complete = OK
    expect(() =>
      validateTrajectory({
        ...validMinimal,
        steps: [
          {
            sequence: 0,
            kind: 'tool_call',
            content: { toolCallId: 'tc1', toolName: 'foo', args: {} },
          },
        ],
      }),
    ).not.toThrow()
  })

  it('VALIDATES tool_result needs toolCallId', () => {
    expect(() =>
      validateTrajectory({
        ...validMinimal,
        steps: [
          {
            sequence: 0,
            kind: 'tool_result',
            content: { output: 'foo' },
          },
        ],
      }),
    ).toThrow()
  })

  it('REJECTS empty agentName', () => {
    expect(() =>
      validateTrajectory({ ...validMinimal, agentName: '' }),
    ).toThrow()
  })

  it('CAPS step count at 2000', () => {
    const steps = Array.from({ length: 2001 }, (_, i) => ({
      sequence: i,
      kind: 'thinking',
      content: { text: 'x' },
    }))
    expect(() =>
      validateTrajectory({ ...validMinimal, steps }),
    ).toThrow()
  })

  it('REJECTS empty steps array', () => {
    expect(() =>
      validateTrajectory({ ...validMinimal, steps: [] }),
    ).toThrow()
  })

  it('accepts thinking + tool_call + tool_result + final_response sequence', () => {
    expect(() =>
      validateTrajectory({
        ...validMinimal,
        steps: [
          {
            sequence: 0,
            kind: 'thinking',
            content: { text: 'planning' },
          },
          {
            sequence: 1,
            kind: 'tool_call',
            content: {
              toolCallId: 'tc',
              toolName: 'search',
              args: { q: 'x' },
            },
          },
          {
            sequence: 2,
            kind: 'tool_result',
            content: { toolCallId: 'tc', output: 'found' },
          },
          {
            sequence: 3,
            kind: 'final_response',
            content: { text: 'done' },
          },
        ],
      }),
    ).not.toThrow()
  })

  it('schemaVersion defaults to 1.0 via Zod default', () => {
    const result = canonicalTrajectorySchema.parse({
      agentName: 'a',
      rootPrompt: 'p',
      source: 'upload',
      steps: [
        { sequence: 0, kind: 'thinking', content: { text: 'x' } },
      ],
    })
    expect(result.schemaVersion).toBe('1.0')
  })
})
