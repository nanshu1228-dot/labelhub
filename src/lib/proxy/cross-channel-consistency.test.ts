import { describe, expect, it } from 'vitest'
import {
  openAIChatToTrajectory,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
} from './openai-compat-adapter'
import {
  anthropicMessagesToTrajectory,
  type AnthropicMessagesRequest,
  type AnthropicMessagesResponse,
} from './anthropic-messages-adapter'
import { adaptCanonical } from '@/lib/trajectories/adapters/canonical'

/**
 * Cross-channel consistency guard.
 *
 * The platform promises that a trajectory captured by the proxy is the
 * SAME shape as a trajectory uploaded via the SDK / ingest API. The two
 * paths have separate adapter code (different teams might extend them
 * over time), so we need a hard-pinned contract that the canonical
 * output of the proxy round-trips through the ingest pathway unchanged.
 *
 * Without this test:
 *   - someone adds a field to proxy capture
 *   - publisher uploads the captured trajectory back to us
 *   - ingest validator throws because of the new field
 *   - annotators see an empty workspace, publisher's data is unreachable
 *
 * The check: take a representative (openai-compat / anthropic) chat
 * exchange, produce T_proxy via openAIChatToTrajectory /
 * anthropicMessagesToTrajectory, then pipe T_proxy through adaptCanonical
 * (the SDK pass-through adapter). The returned T_ingest must deep-equal
 * T_proxy at the canonical-shape level.
 *
 * This is structural — it doesn't probe behavior under bizarre inputs
 * (those are covered by roundtrip-fidelity.test.ts and the adapter unit
 * tests). It exists specifically to catch shape drift between channels.
 */

const baseOpts = {
  agentName: 'test/cross-channel',
  source: 'production' as const,
}

describe('proxy capture ↔ SDK ingest — canonical shape equivalence', () => {
  it('openai-compat: simple chat with reasoning_content + final response', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-seed-2-0-lite-260428',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '4',
            reasoning_content:
              'Trivial arithmetic. 2+2 = 4. No ambiguity in the question.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 3 },
    }
    const tProxy = openAIChatToTrajectory(req, res, baseOpts)
    // Round-trip through the SDK pass-through adapter — what a publisher
    // would do if they captured a proxy trajectory and re-uploaded it.
    const tIngest = adaptCanonical(tProxy)
    expect(tIngest).toEqual(tProxy)
  })

  it('openai-compat: chat with tool_call + tool_result', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-seed-2-0-lite-260428',
      messages: [{ role: 'user', content: 'Weather in 上海?' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ city: '上海', units: 'celsius' }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const tProxy = openAIChatToTrajectory(req, res, baseOpts)
    const tIngest = adaptCanonical(tProxy)
    expect(tIngest).toEqual(tProxy)
    // Spot-check: tool_call step's args came through unchanged on both paths.
    const callStepProxy = tProxy.steps.find((s) => s.kind === 'tool_call')!
    const callStepIngest = tIngest.steps.find((s) => s.kind === 'tool_call')!
    expect(callStepProxy.content).toEqual(callStepIngest.content)
  })

  it('anthropic: simple chat with thinking + final', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello.' }],
    }
    const res: AnthropicMessagesResponse = {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'Hi there!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 3 },
    }
    const tProxy = anthropicMessagesToTrajectory(req, res, baseOpts)
    const tIngest = adaptCanonical(tProxy)
    expect(tIngest).toEqual(tProxy)
  })

  it('anthropic: tool-use response captures tool_call + final text', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: 'List Tokyo restaurants.' }],
    }
    const res: AnthropicMessagesResponse = {
      id: 'msg_02',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'text', text: "I'll search for restaurants." },
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'find_restaurants',
          input: { city: 'Tokyo', cuisine: 'ramen' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 12, output_tokens: 25 },
    }
    const tProxy = anthropicMessagesToTrajectory(req, res, baseOpts)
    const tIngest = adaptCanonical(tProxy)
    expect(tIngest).toEqual(tProxy)
  })

  it('preserves non-ASCII content byte-faithfully through both adapters', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-test',
      messages: [
        {
          role: 'user',
          content: '混合 chars: 你好 + 👨‍👩‍👧‍👦 + ‮hebrew‬ + ∫₀^π',
        },
      ],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              'Mixed: 你好世界, family 👨‍👩‍👧‍👦, RTL ‮test‬, math ∫₀^π = 2.',
          },
          finish_reason: 'stop',
        },
      ],
    }
    const tProxy = openAIChatToTrajectory(req, res, baseOpts)
    const tIngest = adaptCanonical(tProxy)
    expect(tIngest).toEqual(tProxy)
    // Extra paranoia: the EXACT text we sent in must be present in BOTH
    // canonical structures, byte-for-byte (length match guards against
    // silent NFC normalization or escape mangling somewhere in the pipeline).
    expect(tProxy.rootPrompt).toBe(req.messages[0].content as string)
    expect(tIngest.rootPrompt).toBe(req.messages[0].content as string)
    expect(tProxy.rootPrompt.length).toBe(tIngest.rootPrompt.length)
  })

  it('JSON-serialize → parse → adapt: matches behavior over the wire (NOT just in-memory)', () => {
    // The real ingest path is: client serializes trajectory → POST JSON →
    // server JSON.parses → adapter runs. Anything that survives that
    // serialization round-trip is safe; anything that doesn't (Maps, Dates,
    // Symbols, undefined fields) breaks silently.
    const req: OpenAIChatRequest = {
      model: 'doubao-test',
      messages: [{ role: 'user', content: 'echo' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: { role: 'assistant', content: 'echoed' },
          finish_reason: 'stop',
        },
      ],
    }
    const tProxy = openAIChatToTrajectory(req, res, baseOpts)
    // Simulate the wire trip: serialize → parse.
    const overTheWire = JSON.parse(JSON.stringify(tProxy))
    const tIngest = adaptCanonical(overTheWire)
    expect(tIngest).toEqual(tProxy)
  })

  it('rejects a tampered trajectory (validator catches sneak-in fields)', () => {
    // Negative case: if the publisher tries to upload a trajectory with an
    // unknown `kind`, ingest must refuse — proves the canonical adapter is
    // doing real validation, not blind pass-through.
    const malformed = {
      agentName: 'tampered',
      rootPrompt: 'x',
      source: 'production',
      schemaVersion: '1.0',
      steps: [
        { sequence: 0, kind: 'rogue_kind' as 'thinking', content: { text: 'x' } },
      ],
    }
    expect(() => adaptCanonical(malformed)).toThrow()
  })
})
