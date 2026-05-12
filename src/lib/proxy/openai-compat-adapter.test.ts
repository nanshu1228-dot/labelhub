import { describe, expect, it } from 'vitest'
import { validateTrajectory } from '@/lib/trajectories/schema'
import {
  openAIChatToTrajectory,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
} from './openai-compat-adapter'

const baseOpts = { agentName: 'doubao/test', source: 'production' as const }

describe('openAIChatToTrajectory', () => {
  it('captures a plain single-turn chat (no tools) as one final_response step', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: 'Hi there' },
      ],
    }
    const res: OpenAIChatResponse = {
      id: 'cmpl_abc',
      model: 'doubao-1-5-pro-32k-250115',
      choices: [
        {
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 2 },
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj) // throws if shape is bad

    expect(traj.rootPrompt).toBe('Hi there')
    expect(traj.finalResponse).toBe('Hello!')
    expect(traj.steps).toHaveLength(1)
    expect(traj.steps[0].kind).toBe('final_response')
    expect((traj.steps[0].content as { text: string }).text).toBe('Hello!')
    expect(traj.meta?.systemPrompt).toBe('You are concise.')
    expect(traj.meta?.upstreamId).toBe('cmpl_abc')
  })

  it('emits tool_call steps when the response contains tool_calls', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
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
                  arguments: '{"city":"Tokyo"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)

    expect(traj.finalResponse).toBeUndefined()
    expect(traj.steps).toHaveLength(1)
    expect(traj.steps[0].kind).toBe('tool_call')
    const content = traj.steps[0].content as {
      toolCallId: string
      toolName: string
      args: { city: string }
    }
    expect(content.toolCallId).toBe('call_1')
    expect(content.toolName).toBe('get_weather')
    expect(content.args.city).toBe('Tokyo')
  })

  it('preserves multi-turn history with prior tool_call → tool_result pairs', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [
        { role: 'user', content: 'Weather in Tokyo?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"temp_c":18,"sky":"clear"}',
        },
      ],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: { role: 'assistant', content: 'Tokyo is 18°C and clear.' },
          finish_reason: 'stop',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)

    expect(traj.rootPrompt).toBe('Weather in Tokyo?')
    expect(traj.steps).toHaveLength(3)
    expect(traj.steps[0].kind).toBe('tool_call')
    expect(traj.steps[1].kind).toBe('tool_result')
    expect(traj.steps[2].kind).toBe('final_response')
    expect(traj.finalResponse).toBe('Tokyo is 18°C and clear.')
  })

  it('handles malformed tool-call args by wrapping under _raw rather than throwing', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [{ role: 'user', content: 'go' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_x',
                type: 'function',
                function: { name: 'broken', arguments: 'not-json{{' },
              },
            ],
          },
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)
    const content = traj.steps[0].content as { args: { _raw: string } }
    expect(content.args._raw).toBe('not-json{{')
  })

  it('synthesizes an error step when the response is fully empty', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [{ role: 'user', content: 'nope' }],
    }
    const res: OpenAIChatResponse = {
      choices: [{ message: { role: 'assistant', content: null } }],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)
    expect(traj.steps).toHaveLength(1)
    expect(traj.steps[0].kind).toBe('error')
    // Empty response also flips the empty_response QC flag — the annotator
    // would see this and know not to try labeling poison data.
    expect(traj.meta?.qcFlags).toEqual({
      reasons: [{ kind: 'empty_response' }],
    })
  })

  it('flags truncated trajectories (finish_reason=length)', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [{ role: 'user', content: 'write a 10000 word essay' }],
      max_tokens: 100,
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: { role: 'assistant', content: 'Once upon a time...' },
          finish_reason: 'length',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)
    expect(traj.meta?.qcFlags).toEqual({
      reasons: [{ kind: 'truncated', detail: 'length' }],
    })
  })

  it('combines multiple QC reasons into a single flag set', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [{ role: 'user', content: '���h�仰' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: { role: 'assistant', content: '���Ǹ�' },
          finish_reason: 'length',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    const flags = traj.meta?.qcFlags as
      | { reasons: Array<{ kind: string }> }
      | null
    const kinds = (flags?.reasons ?? []).map((r) => r.kind).sort()
    expect(kinds).toEqual(['encoding', 'truncated'])
  })

  it('emits no qcFlags when everything is clean', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [{ role: 'user', content: '上海今天天气怎么样?' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: { role: 'assistant', content: '今天上海多云,18°C。' },
          finish_reason: 'stop',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    expect(traj.meta?.qcFlags).toBeNull()
  })

  it('emits a thinking step for reasoning_content (Doubao R1-style CoT)', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-seed-2-0-lite-260428',
      messages: [{ role: 'user', content: '1 + 1 = ?' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '答案是 2。',
            reasoning_content:
              '用户问 1+1 等于什么。这是基础加法,答案是 2。',
          },
          finish_reason: 'stop',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)

    expect(traj.steps).toHaveLength(2)
    expect(traj.steps[0].kind).toBe('thinking')
    expect((traj.steps[0].content as { text: string }).text).toContain(
      '基础加法',
    )
    expect(traj.steps[1].kind).toBe('final_response')
    expect((traj.steps[1].content as { text: string }).text).toBe('答案是 2。')
    expect(traj.finalResponse).toBe('答案是 2。')
  })

  it('coerces array-of-blocks content to a flat string', () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-1-5-pro-32k',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this: ' },
            { type: 'text', text: 'a cat.' },
          ] as unknown as string,
        },
      ],
    }
    const res: OpenAIChatResponse = {
      choices: [{ message: { role: 'assistant', content: 'A cat.' } }],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    validateTrajectory(traj)
    expect(traj.rootPrompt).toBe('Describe this: a cat.')
  })
})
