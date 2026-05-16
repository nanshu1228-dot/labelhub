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
    eyebrow: 'LabelHub · v0.4 · Private beta',
    hero_h1: 'Capture the teaching, not just the label.',
    hero_sub:
      'An annotation engine for the LLM era. Three modes — pair rubric, arena GSB, and agent-trace eval — over one model-grade scoring engine.',
    cta_start: 'Start a workspace',
    cta_demo: 'See it learn',
    cta_tour_demo: 'Tour the public demo workspace',
    cta_tour_demo_hint: 'No sign-up needed',
    kbd_open: 'Open with',
    kbd_no_card: 'No card required',
    meta_runs: 'RUNS ON',
    meta_runs_v: 'Frontier-lab clusters',
    meta_scale: 'RUBRIC SCALE',
    meta_smooth: 'smooth',
    meta_pair: 'PAIR PARTNER',
    meta_pair_v: 'Claude, in-editor',
    meta_payout: 'PAYOUT',
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
      'Pair-Annotation session moved <span style="color: oklch(0.92 0 0);">Olympiad math</span> +2.1%',
    live_feed_3:
      'Apprentice learned a new rubric rule: <span class="lh-mono" style="color: oklch(0.92 0 0);">&ldquo;cite step 3&rdquo;</span>',
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
    eyebrow: 'LabelHub · v0.4 · 私测中',
    hero_h1: '标的是答案，记的是教学',
    hero_sub:
      'LLM 时代的标注引擎。三种模式——pair rubric、arena GSB、agent trace eval——共用一套模型级评分引擎。',
    cta_start: '创建工作区',
    cta_demo: '看它变聪明',
    cta_tour_demo: '直接参观公开 demo workspace',
    cta_tour_demo_hint: '无需注册',
    kbd_open: '快捷键',
    kbd_no_card: '无需绑卡',
    meta_runs: '运行于',
    meta_runs_v: '前沿实验室集群',
    meta_scale: '评分规模',
    meta_smooth: '流畅',
    meta_pair: '搭档',
    meta_pair_v: 'Claude · 内嵌',
    meta_payout: '结算',
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
      '双人标注使 <span style="color: oklch(0.92 0 0);">奥数</span>提升 +2.1%',
    live_feed_3:
      '学徒学习到新规则：<span class="lh-mono" style="color: oklch(0.92 0 0);">「引用第 3 步」</span>',
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
