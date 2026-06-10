// ─────────────────────────────────────────────────────────────────────────
// Static catalogs + initial state for the eval-run client.
//
// Quick-mode demo data — replace with real DB data once we add
// agent_templates + rubrics tables. Extracted verbatim from
// eval-run-client.tsx as part of a behavior-preserving decomposition.
// ─────────────────────────────────────────────────────────────────────────

import type { AdvancedState, AgentTemplate } from './types'

export const MODELS = [
  { id: 'claude-sonnet-4-6', short: 'Sonnet 4.6', tag: 'balanced' },
  { id: 'claude-opus-4-7', short: 'Opus 4.7', tag: 'strongest' },
  { id: 'claude-haiku-4-5-20251001', short: 'Haiku 4.5', tag: 'fastest' },
] as const

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'tp-v2',
    name: 'Travel Planner v2',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    systemPrompt:
      'You are a travel planning agent. Use the search_flights and book_hotel tools to assemble a 3-day itinerary within budget. Be concise, prefer mid-range options unless budget says otherwise.',
    tools: [
      {
        id: 't1',
        name: 'search_flights',
        desc: 'Search flights between two airports for a date range.',
        open: false,
        schema: `{
  "type": "object",
  "properties": {
    "origin": { "type": "string" },
    "destination": { "type": "string" },
    "dates": { "type": "object", "properties": { "depart": { "type": "string" }, "return": { "type": "string" } } },
    "budget_usd": { "type": "number" }
  },
  "required": ["origin", "destination", "dates"]
}`,
      },
      {
        id: 't2',
        name: 'book_hotel',
        desc: 'Book a hotel given city and price range.',
        open: false,
        schema: `{
  "type": "object",
  "properties": {
    "city": { "type": "string" },
    "check_in": { "type": "string" },
    "check_out": { "type": "string" },
    "price_max": { "type": "number" }
  },
  "required": ["city", "check_in", "check_out"]
}`,
      },
    ],
    toolsCount: 2,
    updated: '2d ago',
    author: 'demo',
    runs: 41,
  },
  {
    id: 'code-review',
    name: 'Code Review Bot',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    systemPrompt:
      'You are a senior code reviewer. Inspect the diff using read_file and run_tests. Flag security issues first, then correctness, then style.',
    tools: [],
    toolsCount: 4,
    updated: '5d ago',
    author: 'demo',
    runs: 128,
  },
  {
    id: 'med-qa',
    name: 'Medical Q&A Triager',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    systemPrompt:
      'You are a medical triage assistant. Never give diagnoses. Use search_kb to look up symptoms and escalate to a human if uncertain.',
    tools: [],
    toolsCount: 3,
    updated: '1w ago',
    author: 'team',
    runs: 92,
  },
  {
    id: 'support',
    name: 'Customer Support Agent',
    model: 'claude-haiku-4-5-20251001',
    modelLabel: 'Claude Haiku 4.5',
    systemPrompt:
      'You are a customer support agent. Use lookup_order, refund_request, and escalate_to_human as needed.',
    tools: [],
    toolsCount: 5,
    updated: '2w ago',
    author: 'team',
    runs: 311,
  },
]

export const RUBRICS = [
  {
    id: 'fact-helpful',
    name: 'Factuality + Helpfulness',
    criteria: 4,
    mode: '1–4 Likert',
    desc: 'Standard correctness rubric.',
  },
  {
    id: 'tool-correct',
    name: 'Tool-use correctness',
    criteria: 3,
    mode: 'Pass / Fail / Partial',
    desc: 'Did the agent pick the right tools with the right args?',
  },
  {
    id: 'harms',
    name: 'Safety + Harms',
    criteria: 6,
    mode: 'Tags',
    desc: 'Multi-label harms taxonomy.',
  },
  {
    id: 'custom',
    name: 'Custom rubric',
    criteria: 0,
    mode: 'build inline',
    desc: 'Define your own criteria.',
    custom: true,
  },
] as const

export const INITIAL_ADVANCED_STATE: AdvancedState = {
  agentName: 'travel-planner-v2',
  model: 'claude-sonnet-4-6',
  systemPrompt: AGENT_TEMPLATES[0].systemPrompt,
  tools: AGENT_TEMPLATES[0].tools,
  inputs: [
    { id: 'i1', text: 'Plan a 3-day Tokyo trip in early March, mid-budget.' },
    {
      id: 'i2',
      text: 'Find me a hotel in Paris under $200/night for next weekend.',
    },
    { id: 'i3', text: 'Bangkok 5-day, beach + temples, ¥8000 budget.' },
  ],
}
