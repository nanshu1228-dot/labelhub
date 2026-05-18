'use client'
/**
 * LabelHub i18n — dictionary + Context (no JSX).
 * Provider component lives in `src/components/site/lang-provider.tsx`.
 */

import { createContext, useContext } from 'react'

export type Lang = 'en' | 'zh'

export const DICT = {
  en: {
    nav_templates: 'Templates',
    nav_marketplace: 'Marketplace',
    nav_pricing: 'Pricing',
    nav_docs: 'Docs',
    nav_changelog: 'Changelog',
    auth_login: 'Log in',
    auth_signup: 'Sign up',
    eyebrow: 'LabelHub · v0.5 · The Annotation-Aware LLM Gateway',
    hero_h1: 'The Annotation-Aware LLM Gateway.',
    hero_sub:
      'Drop in as your OpenAI/Anthropic base URL. Every agent call gets captured to a canonical trajectory, scope-guarded against key abuse, and forkable for counterfactual teaching — no SDK changes, no second pipeline.',
    cta_start: 'Start a workspace',
    cta_demo: 'See the three pillars',
    cta_tour_demo: 'Tour the public demo workspace',
    cta_tour_demo_hint: 'No sign-up needed',
    kbd_open: 'Open with',
    kbd_no_card: 'No card required',
    snip_label: '3-LINE DROP-IN · NO SDK CHANGES',
    snip_caption:
      'Same OpenAI/Anthropic SDK you already use. Swap base URL → trajectories appear in your workspace.',
    snip_copy: 'copy',
    snip_copied: 'copied ✓',
    meta_trajectories: 'TRAJECTORIES CAPTURED',
    meta_tool_calls: 'TOOL CALLS LOGGED',
    meta_teaching: 'TEACHING SIGNALS',
    meta_workspaces: 'WORKSPACES',
    video_placeholder_eyebrow: '§ 60–90 SEC DEMO',
    video_placeholder_body:
      'Walkthrough video lands here in v0.6 — capture → re-simulate → export.',
    gp_section: '§ 01   THE GATEWAY THESIS',
    gp_h: 'Three things happen on every model call. Zero code from you.',
    gp_sub:
      'Scale and Surge only label. LangSmith only observes. LiteLLM only proxies. LabelHub stitches all three around one signal: the teaching delta between AI proposals and human corrections.',
    gp1_tag: '① AUTO-CAPTURE',
    gp1_title: 'Canonical trajectory schema',
    gp1_body:
      'Every request flows through the proxy and lands as a typed trajectory: prompt, tool calls, tool results, latency, tokens, cost. Works for OpenAI, Anthropic, Doubao, DeepSeek, Kimi, GLM.',
    gp2_tag: '② SCOPE-INJECT',
    gp2_title: 'Topic-scope guardrail',
    gp2_body:
      'Each task auto-generates a policy prefix — “medical Q&A only” — that we inject into the system prompt before forwarding. A leaked key cannot be repurposed for off-task work.',
    gp3_tag: '③ TEACH-BACK',
    gp3_title: 'Teaching-signal export',
    gp3_body:
      'Every annotation captures the (AI proposal, human correction, delta) triplet alongside the rubric marks. One click → SFT/DPO-ready JSONL. Close the loop, do not just label.',
    gp_cta_read: 'read the spec',
    tpl_section: '§ 02   TEMPLATES',
    tpl_h: 'Three modes. One engine. Pick the shape of the teaching.',
    tpl_all: 'All templates',
    c1_tag: '01 · PAIR RUBRIC',
    c1_badge: 'yes / no · per model',
    c1_title: 'Pair Rubric',
    c1_body:
      'Two model answers, one shared yes/no checklist. Atomic per-cell checks, virtualized to a thousand rubrics. The cleanest signal for SFT.',
    c2_tag: '02 · ARENA GSB',
    c2_wins: 'A wins · 64%',
    c2_b: 'B · 36%',
    c2_title: 'Arena GSB',
    c2_body:
      'LMSYS-style head-to-head with multi-dimension 1–5 scoring. GSB verdict per dimension, plus required reasoning. Drives Bradley-Terry / Elo.',
    c3_tag: '03 · AGENT TRACE EVAL',
    c3_badge: 'per-step · trajectory',
    c3_title: 'Agent Trace Eval',
    c3_body:
      'Score every step of an agent trajectory — tool calls, results, final answer. Per-step rubric + per-trajectory verdict. The flagship for agent eval.',
    tpl_closing:
      'Switch modes per task. Mix them per workspace. The rubric, the trust score, and the audit trail travel with you.',
    tpl_spec: 'Read the spec',
    live_section: '§ 03   LIVE LEARNING',
    live_h: 'Watch your model learn.',
    live_sub:
      'Every accepted label updates the curve in real time. Hover any point to see which annotators moved it.',
    live_acc: 'Accuracy',
    live_factuality: 'Factuality',
    live_helpfulness: 'Helpfulness',
    live_safety: 'Safety',
    live_now: 'now',
    live_pill1_delta: '+0.9%',
    live_pill1_label: 'from your last 5 labels',
    live_pill2_delta: '+1.4%',
    live_pill2_label: 'after rubric patch',
    live_feed_h: 'IMPACT FEED',
    live_feed_1:
      'Your labels improved <span style="color: oklch(0.92 0 0);">factuality</span> 78% → 81%',
    live_feed_2:
      'Pair-Rubric session moved <span style="color: oklch(0.92 0 0);">Olympiad math</span> +2.1%',
    live_feed_3:
      'Guideline refiner learned a new rule: <span class="lh-mono" style="color: oklch(0.92 0 0);">&ldquo;cite step 3&rdquo;</span>',
    live_feed_4:
      '<span class="lh-mono" style="color: oklch(0.92 0 0);">24</span> annotators contributed to medical Q&A · last 1h',
    footer_tagline: 'Capture the teaching, not just the label.',
    footer_status: 'All systems normal',
    footer_product: 'PRODUCT',
    footer_company: 'COMPANY',
    footer_legal: 'LEGAL',
    footer_templates: 'Templates',
    footer_marketplace: 'Marketplace',
    footer_pricing: 'Pricing',
    footer_changelog: 'Changelog',
    footer_about: 'About',
    footer_careers: 'Careers',
    footer_blog: 'Blog',
    footer_contact: 'Contact',
    footer_terms: 'Terms',
    footer_privacy: 'Privacy',
    footer_security: 'Security',
    footer_docs: 'Docs',
    footer_built: 'Built for the LLM era · SOC 2 in progress',
  },
  zh: {
    nav_templates: '模板',
    nav_marketplace: '任务广场',
    nav_pricing: '定价',
    nav_docs: '文档',
    nav_changelog: '更新日志',
    auth_login: '登录',
    auth_signup: '注册',
    eyebrow: 'LabelHub · v0.5 · 标注内置的 LLM 网关',
    hero_h1: '标注内置的 LLM 网关',
    hero_sub:
      '把你的 OpenAI / Anthropic base URL 换成 LabelHub —— agent 的每一次调用都会自动入库为可标注的轨迹、被任务范围策略保护、且可从任意 step 分叉重跑。零 SDK 改动，没有第二条管线。',
    cta_start: '创建工作区',
    cta_demo: '看三大支柱',
    cta_tour_demo: '直接参观公开 demo workspace',
    cta_tour_demo_hint: '无需注册',
    kbd_open: '快捷键',
    kbd_no_card: '无需绑卡',
    snip_label: '三行接入 · 无需改 SDK',
    snip_caption:
      '沿用你已有的 OpenAI / Anthropic SDK，只改 base URL —— 轨迹立刻出现在你的工作区。',
    snip_copy: '复制',
    snip_copied: '已复制 ✓',
    meta_trajectories: '已捕获轨迹',
    meta_tool_calls: '已记录工具调用',
    meta_teaching: '教学信号',
    meta_workspaces: '工作区',
    video_placeholder_eyebrow: '§ 60–90 秒演示',
    video_placeholder_body:
      '演示视频将在 v0.6 上线：捕获 → 反事实重跑 → 教学信号导出。',
    gp_section: '§ 01   网关三支柱',
    gp_h: '每次模型调用做三件事，你一行代码不用写。',
    gp_sub:
      'Scale / Surge 只做标注，LangSmith 只看日志，LiteLLM 只做代理。LabelHub 把这三件事缝在同一条信号线上 —— AI 提议与人类修正之间的「教学增量」。',
    gp1_tag: '① 自动捕获',
    gp1_title: '规范化轨迹 schema',
    gp1_body:
      '请求经代理转发，落库为带类型的轨迹：prompt、工具调用、返回值、延迟、token、成本。OpenAI / Anthropic / 豆包 / DeepSeek / Kimi / GLM 全支持。',
    gp2_tag: '② 范围注入',
    gp2_title: '任务范围策略护栏',
    gp2_body:
      '每个任务自动生成一段策略前缀（如「仅医疗 Q&A」），在转发前注入到系统提示。Key 即使被偷也无法用于跨任务滥用。',
    gp3_tag: '③ 反向教学',
    gp3_title: '教学信号导出',
    gp3_body:
      '每条标注都附带「AI 提议 / 人类修正 / 差量」三元组以及评分单。一键导出 SFT/DPO 兼容的 JSONL —— 闭环，而不仅是打标。',
    gp_cta_read: '查看规范',
    tpl_section: '§ 02   模板',
    tpl_h: '三种模式，一个引擎。选择你想要的教学形态。',
    tpl_all: '查看全部',
    c1_tag: '01 · PAIR RUBRIC',
    c1_badge: 'yes / no · 双模型',
    c1_title: 'Pair Rubric',
    c1_body:
      '两个模型答案，一份共享的 yes/no 评分单。每格独立，千行流畅。SFT 信号最干净的一种。',
    c2_tag: '02 · ARENA GSB',
    c2_wins: 'A 胜 · 64%',
    c2_b: 'B · 36%',
    c2_title: 'Arena GSB',
    c2_body:
      'LMSYS 风格的双模型对战，多维 1–5 评分。每维 GSB 判定加必填理由。直接驱动 Bradley-Terry / Elo。',
    c3_tag: '03 · AGENT TRACE EVAL',
    c3_badge: 'per-step · 整轨迹',
    c3_title: 'Agent Trace Eval',
    c3_body:
      '为 agent 轨迹的每一步打分——工具调用、返回值、最终答案。逐步评分加整轨迹判定。Agent 评测的旗舰模式。',
    tpl_closing: '按任务切换模式，按工作区组合。评分、信誉、审计轨迹随你迁移。',
    tpl_spec: '查看规范',
    live_section: '§ 03   实时学习',
    live_h: '看着你的模型变聪明。',
    live_sub: '每一条被采纳的标注都会实时更新曲线。悬停任一点，看见是谁推动了它。',
    live_acc: '准确率',
    live_factuality: '事实性',
    live_helpfulness: '有用性',
    live_safety: '安全性',
    live_now: '当前',
    live_pill1_delta: '+0.9%',
    live_pill1_label: '近 5 条标注',
    live_pill2_delta: '+1.4%',
    live_pill2_label: '规则更新后',
    live_feed_h: '影响信息流',
    live_feed_1: '你的标注让<span style="color: oklch(0.92 0 0);">事实性</span>从 78% → 81%',
    live_feed_2:
      'Pair-Rubric 标注使 <span style="color: oklch(0.92 0 0);">奥数</span>提升 +2.1%',
    live_feed_3:
      '指南细化器学习到新规则：<span class="lh-mono" style="color: oklch(0.92 0 0);">「引用第 3 步」</span>',
    live_feed_4:
      '过去 1 小时 · <span class="lh-mono" style="color: oklch(0.92 0 0);">24</span> 名标注者贡献于医学问答',
    footer_tagline: '标的是答案，记的是教学。',
    footer_status: '系统运行正常',
    footer_product: '产品',
    footer_company: '公司',
    footer_legal: '条款',
    footer_templates: '模板',
    footer_marketplace: '任务广场',
    footer_pricing: '定价',
    footer_changelog: '更新日志',
    footer_about: '关于',
    footer_careers: '招聘',
    footer_blog: '博客',
    footer_contact: '联系',
    footer_terms: '条款',
    footer_privacy: '隐私',
    footer_security: '安全',
    footer_docs: '文档',
    footer_built: '为 LLM 时代而建 · SOC 2 进行中',
  },
} as const

export type DictKey = keyof (typeof DICT)['en']

export const STORAGE_KEY = 'labelhub.lang'

export type LangContextValue = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: DictKey) => string
}

export const LangContext = createContext<LangContextValue | null>(null)

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>')
  return ctx
}
