import { describe, expect, it } from 'vitest'
import {
  openAIChatToTrajectory,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
} from './openai-compat-adapter'

/**
 * Round-trip fidelity guard.
 *
 * The platform's worst failure mode is "annotation correct × data wrong":
 * the annotator labels exactly what they see, but what they see drifted
 * from what the agent actually produced — usually because of a silent
 * encoding bug, JSON re-serialization quirk, or whitespace normalization
 * somewhere in the pipeline.
 *
 * These tests pin the contract that the proxy's adapter is byte-faithful:
 * EVERY rune the upstream sent, EVERY byte the user typed, ends up in the
 * canonical trajectory with NO modifications. If anything down this lane
 * silently transforms text, this test must scream.
 *
 * If you find yourself "fixing" one of these tests, stop. The text payload
 * is the audit truth. Any normalization belongs in a SEPARATE display layer
 * tagged as such; the underlying capture must remain pristine.
 */

const baseOpts = {
  agentName: 'doubao/roundtrip-test',
  source: 'production' as const,
}

function fidelityCase(name: string, prompt: string, answer: string) {
  it(`preserves: ${name}`, () => {
    const req: OpenAIChatRequest = {
      model: 'doubao-test',
      messages: [{ role: 'user', content: prompt }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: { role: 'assistant', content: answer },
          finish_reason: 'stop',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)

    // rootPrompt + finalResponse must be the EXACT input strings — same length,
    // same code points, same order. No silent NFC normalization, no escape
    // mangling, no whitespace stripping.
    expect(traj.rootPrompt).toBe(prompt)
    expect(traj.rootPrompt.length).toBe(prompt.length)
    expect(traj.finalResponse).toBe(answer)
    expect(traj.finalResponse?.length).toBe(answer.length)

    // The trailing step's content.text must also match — UI reads from steps,
    // not from finalResponse alone, so we test both surfaces.
    const finalStep = traj.steps[traj.steps.length - 1]
    expect(finalStep.kind).toBe('final_response')
    expect((finalStep.content as { text: string }).text).toBe(answer)
  })
}

describe('round-trip fidelity (capture → canonical trajectory)', () => {
  fidelityCase('plain ASCII', 'Hello, world.', 'Hi there!')

  fidelityCase(
    'Chinese with punctuation',
    '你好,今天的天气怎么样?',
    '今天上海多云,气温 18°C,东南风 3 级。',
  )

  fidelityCase(
    'Japanese mixed with kanji',
    '東京の天気を教えてください。',
    '東京は晴れ、気温は20℃です。',
  )

  fidelityCase(
    'emoji + ZWJ sequences',
    'Family: 👨‍👩‍👧‍👦 and waving 👋🏽 hand!',
    'Got it 👍 — family emoji and skin-tone modifier received.',
  )

  fidelityCase(
    'mathematical / scientific symbols',
    'Solve: ∫₀^π sin(x) dx = ?  Also √2 ≈ ?',
    '∫₀^π sin(x) dx = 2;  √2 ≈ 1.41421356…',
  )

  fidelityCase(
    'leading + trailing whitespace + multiple newlines',
    '   \n  question with spaces  \n\n   ',
    '  line1\n\n  line2\n\n\n  line3   ',
  )

  fidelityCase(
    'tabs + tabs + tabs',
    'col1\tcol2\tcol3',
    'a\tb\tc\nd\te\tf',
  )

  fidelityCase(
    'embedded quotes + backslashes + JSON-looking content',
    'Parse this: {"key": "value with \\"escaped quotes\\""}',
    'Output: \\"hello\\" with a backslash \\\\\\\\ inside',
  )

  fidelityCase(
    'HTML-like content (must NOT be auto-escaped at capture time)',
    'What does <script>alert("xss")</script> mean?',
    'It\'s an HTML <script> tag with an alert call: <script>alert("xss")</script>',
  )

  fidelityCase(
    'long unicode private-use + RTL marker text',
    'Right-to-left: ‮هذا نص عربي‬  end',
    'Mixed: عربي then English then ‫עברית‬',
  )

  // Combining diacritics — must stay as composed sequences, not NFC'd.
  it('preserves combining diacritics without re-normalizing', () => {
    const combiningE = 'é' // e + combining acute accent → "é" in display
    const composedE = 'é' // precomposed "é"
    const prompt = `Compare: ${combiningE} vs ${composedE}`
    const req: OpenAIChatRequest = {
      model: 'doubao-test',
      messages: [{ role: 'user', content: prompt }],
    }
    const res: OpenAIChatResponse = {
      choices: [{ message: { role: 'assistant', content: 'noted' } }],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    // The two visually-identical "é"s must stay distinct in the captured bytes —
    // we MUST NOT NFC-normalize at capture time or we corrupt audit truth.
    expect(traj.rootPrompt).toBe(prompt)
    expect(traj.rootPrompt.charCodeAt(9)).toBe(0x65) // 'e'
    expect(traj.rootPrompt.charCodeAt(10)).toBe(0x0301) // combining acute
    expect(traj.rootPrompt.charCodeAt(15)).toBe(0x00e9) // precomposed
  })

  it('preserves tool_call args as PARSED objects without lossy re-serialization', () => {
    // OpenAI wire spec: tool args are JSON-stringified. We parse once at
    // capture; the data is then stored as a JSON object. Round-trip MUST
    // preserve every key + every value.
    const rawArgs = {
      city: '上海 / 北京',
      coords: [31.2304, 121.4737],
      flags: { include_hourly: true, units: 'celsius' },
      note: 'with "quotes" and \\ backslash',
    }
    const req: OpenAIChatRequest = {
      model: 'doubao-test',
      messages: [{ role: 'user', content: 'weather?' }],
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
                  arguments: JSON.stringify(rawArgs),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    const callStep = traj.steps.find((s) => s.kind === 'tool_call')!
    const stored = (callStep.content as { args: typeof rawArgs }).args
    // Deep-equality — every nested field round-trips identically.
    expect(stored).toEqual(rawArgs)
  })

  it('keeps Doubao reasoning_content verbatim — never trimmed or filtered', () => {
    const reasoning =
      '我先想想:用户问的是 1+1 等于几。\n这是基础加法,答案显然是 2。\n但要不要解释一下整数加法的定义?'
    const req: OpenAIChatRequest = {
      model: 'doubao-test',
      messages: [{ role: 'user', content: '1+1=?' }],
    }
    const res: OpenAIChatResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '2',
            reasoning_content: reasoning,
          },
          finish_reason: 'stop',
        },
      ],
    }
    const traj = openAIChatToTrajectory(req, res, baseOpts)
    const thinking = traj.steps.find((s) => s.kind === 'thinking')!
    expect((thinking.content as { text: string }).text).toBe(reasoning)
    // Length match guarantees no silent whitespace mangling.
    expect((thinking.content as { text: string }).text.length).toBe(
      reasoning.length,
    )
  })
})
