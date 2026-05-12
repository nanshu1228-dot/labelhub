import { describe, expect, it } from 'vitest'
import { validateTrajectory } from '@/lib/trajectories/schema'
import {
  anthropicMessagesToTrajectory,
  type AnthropicMessagesRequest,
  type AnthropicMessagesResponse,
} from './anthropic-messages-adapter'

const baseOpts = {
  agentName: 'anthropic/claude-test',
  source: 'production' as const,
}

describe('anthropicMessagesToTrajectory', () => {
  it('captures a single-turn text reply as one final_response', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hi.' }],
    }
    const res: AnthropicMessagesResponse = {
      id: 'msg_abc',
      model: 'claude-sonnet-4-6-20251020',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 2 },
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)

    expect(traj.rootPrompt).toBe('Hi.')
    expect(traj.finalResponse).toBe('Hello!')
    expect(traj.steps).toHaveLength(1)
    expect(traj.steps[0].kind).toBe('final_response')
    expect(traj.meta?.provider).toBe('anthropic')
    expect(traj.meta?.systemPrompt).toBe('You are helpful.')
    expect(traj.meta?.stopReason).toBe('end_turn')
    expect(traj.meta?.upstreamId).toBe('msg_abc')
  })

  it('emits tool_call when response has a tool_use block', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
      tools: [{ name: 'get_weather', description: '…', input_schema: {} }],
    }
    const res: AnthropicMessagesResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'get_weather',
          input: { city: 'Tokyo' },
        },
      ],
      stop_reason: 'tool_use',
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)

    expect(traj.finalResponse).toBeUndefined()
    expect(traj.steps).toHaveLength(1)
    const step = traj.steps[0]
    expect(step.kind).toBe('tool_call')
    const content = step.content as {
      toolCallId: string
      toolName: string
      args: { city: string }
    }
    expect(content.toolCallId).toBe('toolu_01')
    expect(content.toolName).toBe('get_weather')
    expect(content.args.city).toBe('Tokyo') // input is already an object, not stringified
  })

  it('captures extended-thinking content as a thinking step before text', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hard question.' }],
    }
    const res: AnthropicMessagesResponse = {
      content: [
        { type: 'thinking', thinking: 'Let me reason about this carefully.' },
        { type: 'text', text: 'Here is the answer.' },
      ],
      stop_reason: 'end_turn',
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)

    expect(traj.steps).toHaveLength(2)
    expect(traj.steps[0].kind).toBe('thinking')
    expect((traj.steps[0].content as { text: string }).text).toContain(
      'reason about this',
    )
    expect(traj.steps[1].kind).toBe('final_response')
    expect(traj.finalResponse).toBe('Here is the answer.')
  })

  it('handles multi-turn history with prior tool_use → tool_result blocks', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'user', content: 'Weather in Tokyo?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'get_weather',
              input: { city: 'Tokyo' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: '18°C clear',
            },
          ],
        },
      ],
    }
    const res: AnthropicMessagesResponse = {
      content: [{ type: 'text', text: 'Tokyo is 18°C and clear.' }],
      stop_reason: 'end_turn',
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)
    expect(traj.rootPrompt).toBe('Weather in Tokyo?')
    expect(traj.steps).toHaveLength(3)
    expect(traj.steps[0].kind).toBe('tool_call')
    expect(traj.steps[1].kind).toBe('tool_result')
    expect(traj.steps[2].kind).toBe('final_response')
    expect(traj.finalResponse).toBe('Tokyo is 18°C and clear.')
  })

  it('flattens an array-form system field (cache-aware blocks)', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      system: [
        { type: 'text', text: 'Be concise.' },
        {
          type: 'text',
          text: 'Use English.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: 'Go.' }],
    }
    const res: AnthropicMessagesResponse = {
      content: [{ type: 'text', text: 'k.' }],
      stop_reason: 'end_turn',
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    expect(traj.meta?.systemPrompt).toBe('Be concise.\n\nUse English.')
  })

  it('flags truncated when stop_reason=max_tokens', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'long' }],
      max_tokens: 10,
    }
    const res: AnthropicMessagesResponse = {
      content: [{ type: 'text', text: 'Once upon' }],
      stop_reason: 'max_tokens',
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    expect(traj.meta?.qcFlags).toEqual({
      reasons: [{ kind: 'truncated', detail: 'max_tokens' }],
    })
  })

  it('flags empty_response when no content and no tool_use', () => {
    const req: AnthropicMessagesRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    }
    const res: AnthropicMessagesResponse = {
      content: [],
      stop_reason: 'end_turn',
    }
    const traj = anthropicMessagesToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)
    expect(traj.steps[0].kind).toBe('error')
    expect(traj.meta?.qcFlags).toEqual({
      reasons: [{ kind: 'empty_response' }],
    })
  })

  it('preserves tool_use input as the object Anthropic sent (not re-stringified)', () => {
    const input = {
      city: '上海 / 北京',
      coords: [31.2304, 121.4737],
      flags: { hourly: true },
    }
    const res: AnthropicMessagesResponse = {
      content: [
        { type: 'tool_use', id: 'tu', name: 'get_weather', input },
      ],
      stop_reason: 'tool_use',
    }
    const traj = anthropicMessagesToTrajectory(
      {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'go' }],
      },
      res,
      baseOpts,
    )
    const stored = (traj.steps[0].content as { args: typeof input }).args
    expect(stored).toEqual(input)
  })
})
