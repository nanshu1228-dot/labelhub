import { describe, expect, it } from 'vitest'
import { adaptCanonical } from './adapters/canonical'
import { adaptAnthropic } from './adapters/anthropic'
import { adaptOpenAIAssistants } from './adapters/openai-assistants'
import { detectFormat } from './detect'
import type { CanonicalTrajectory } from './schema'

describe('Trajectory adapters', () => {
  // ── Canonical ─────────────────────────────────────────────────────────
  describe('canonical (passthrough)', () => {
    const valid: CanonicalTrajectory = {
      agentName: 'test-agent',
      rootPrompt: 'hello',
      source: 'upload',
      schemaVersion: '1.0',
      steps: [
        {
          sequence: 0,
          kind: 'final_response',
          content: { text: 'hi back' },
        },
      ],
    }

    it('round-trips a minimal trajectory', () => {
      const out = adaptCanonical(valid)
      expect(out.agentName).toBe('test-agent')
      expect(out.steps).toHaveLength(1)
      expect(out.steps[0].kind).toBe('final_response')
    })

    it('honors source override', () => {
      const out = adaptCanonical(valid, { source: 'eval-run' })
      expect(out.source).toBe('eval-run')
    })

    it('honors agentName override', () => {
      const out = adaptCanonical(valid, { agentName: 'renamed' })
      expect(out.agentName).toBe('renamed')
    })

    it('REJECTS invalid step kind', () => {
      const bad = {
        ...valid,
        steps: [{ sequence: 0, kind: 'invalid_kind', content: {} }],
      }
      expect(() => adaptCanonical(bad)).toThrow()
    })

    it('REJECTS tool_call missing toolCallId', () => {
      const bad = {
        ...valid,
        steps: [
          {
            sequence: 0,
            kind: 'tool_call',
            content: { toolName: 'foo' }, // missing toolCallId
          },
        ],
      }
      expect(() => adaptCanonical(bad)).toThrow()
    })
  })

  // ── Anthropic ─────────────────────────────────────────────────────────
  describe('anthropic Messages API', () => {
    it('handles text-only assistant response', () => {
      const input = {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'what is 2+2?' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: '4' }],
          },
        ],
      }
      const out = adaptAnthropic(input, {
        agentName: 'math-bot',
        source: 'upload',
      })
      expect(out.rootPrompt).toBe('what is 2+2?')
      expect(out.agentName).toBe('math-bot')
      expect(out.steps).toHaveLength(1)
      expect(out.steps[0].kind).toBe('final_response')
      expect(out.finalResponse).toBe('4')
    })

    it('handles a full tool-use round trip', () => {
      const input = {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'check weather in Tokyo' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: "I'll check the weather." },
              {
                type: 'tool_use',
                id: 'tu_001',
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
                tool_use_id: 'tu_001',
                content: 'sunny 22C',
              },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Tokyo is sunny, 22C.' }],
          },
        ],
      }
      const out = adaptAnthropic(input, {
        agentName: 'weather-bot',
        source: 'upload',
      })

      const kinds = out.steps.map((s) => s.kind)
      expect(kinds).toContain('thinking')
      expect(kinds).toContain('tool_call')
      expect(kinds).toContain('tool_result')
      expect(kinds[kinds.length - 1]).toBe('final_response')

      const toolCall = out.steps.find((s) => s.kind === 'tool_call')
      expect(toolCall).toBeDefined()
      expect((toolCall!.content as { toolName: string }).toolName).toBe(
        'get_weather',
      )

      const toolResult = out.steps.find((s) => s.kind === 'tool_result')
      expect((toolResult!.content as { toolCallId: string }).toolCallId).toBe(
        'tu_001',
      )
    })

    it('captures system prompt into meta', () => {
      const input = {
        system: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        ],
      }
      const out = adaptAnthropic(input, {
        agentName: 'a',
        source: 'upload',
      })
      expect(out.meta?.systemPrompt).toBe('You are a helpful assistant.')
    })

    it('THROWS on missing messages', () => {
      expect(() =>
        adaptAnthropic({}, { agentName: 'x', source: 'upload' }),
      ).toThrow(/messages/)
    })

    it('THROWS on non-object input', () => {
      expect(() =>
        adaptAnthropic('not an object', {
          agentName: 'x',
          source: 'upload',
        }),
      ).toThrow()
    })
  })

  // ── OpenAI Assistants ─────────────────────────────────────────────────
  describe('openai-assistants', () => {
    it('handles message_creation steps', () => {
      const input = {
        model: 'gpt-5',
        initial_user_message: 'tell me a joke',
        run_steps: [
          {
            type: 'message_creation',
            step_details: {
              message_creation: {
                content: [{ type: 'text', text: { value: 'Why did the chicken…' } }],
              },
            },
          },
        ],
      }
      const out = adaptOpenAIAssistants(input, {
        agentName: 'joker',
        source: 'upload',
      })
      expect(out.rootPrompt).toBe('tell me a joke')
      expect(out.steps).toHaveLength(1)
      expect(out.steps[0].kind).toBe('final_response')
    })

    it('handles tool_calls with output', () => {
      const input = {
        run_steps: [
          {
            type: 'tool_calls',
            step_details: {
              tool_calls: [
                {
                  id: 'call_x',
                  type: 'function',
                  function: {
                    name: 'lookup_user',
                    arguments: '{"id": 42}',
                    output: '{"name": "Alice"}',
                  },
                },
              ],
            },
          },
        ],
      }
      const out = adaptOpenAIAssistants(input, {
        agentName: 'crm-bot',
        source: 'upload',
      })
      expect(out.steps.filter((s) => s.kind === 'tool_call')).toHaveLength(1)
      expect(out.steps.filter((s) => s.kind === 'tool_result')).toHaveLength(1)
    })
  })

  // ── Format detection ──────────────────────────────────────────────────
  describe('detectFormat', () => {
    it('identifies canonical', () => {
      expect(
        detectFormat({
          schemaVersion: '1.0',
          agentName: 'a',
          steps: [],
        }),
      ).toBe('canonical')
    })

    it('identifies anthropic via tool_use blocks', () => {
      expect(
        detectFormat({
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'tool_use', id: '1', name: 'x' }],
            },
          ],
        }),
      ).toBe('anthropic')
    })

    it('identifies anthropic via plain messages array', () => {
      expect(
        detectFormat({
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).toBe('anthropic')
    })

    it('identifies openai-assistants via run_steps', () => {
      expect(detectFormat({ run_steps: [] })).toBe('openai-assistants')
    })

    it('identifies openai-assistants via object=thread.run', () => {
      expect(detectFormat({ object: 'thread.run' })).toBe('openai-assistants')
    })

    it('returns unknown for nonsense', () => {
      expect(detectFormat({ random: 'data' })).toBe('unknown')
      expect(detectFormat(null)).toBe('unknown')
      expect(detectFormat('a string')).toBe('unknown')
      expect(detectFormat(42)).toBe('unknown')
    })
  })
})
