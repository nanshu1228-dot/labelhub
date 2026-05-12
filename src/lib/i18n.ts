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
      'An annotation engine for the LLM era. Six template modes — survey, pair, arena, tokens, game, apprentice — over one model-grade rubric.',
    cta_start: 'Start a workspace',
    cta_demo: 'See it learn',
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
    tpl_h: 'Six modes. One engine. Pick the shape of the teaching.',
    tpl_all: 'All templates',
    c1_tag: '01 · CLASSIC SURVEY',
    c1_badge: '847 rows',
    c1_title: 'Classic Survey',
    c1_body:
      'Tabular rubrics over many items and many models. Atomic checkboxes per cell, virtualized to a thousand rows.',
    c2_tag: '02 · PAIR ANNOTATION',
    c2_badge: 'live',
    c2_title: 'Pair Annotation',
    c2_body:
      'Label alongside Claude. Accept, edit, or reject its take — capture the reasoning behind each call.',
    c3_tag: '03 · ARENA BATTLE',
    c3_wins: 'A wins · 64%',
    c3_b: 'B · 36%',
    c3_title: 'Arena Battle',
    c3_body:
      'LMSYS-style head-to-head. Pick a winner, write a one-line reason — the rubric infers itself.',
    c4_tag: '04 · TOKEN ECONOMY',
    c4_badge: '+128 LBH today',
    c4_balance: 'LBH balance',
    c4_l1: 'SFT · medical Q&A',
    c4_l2: 'RLHF · code review',
    c4_l3: 'Eval · agent traces',
    c4_l4: 'Red-team · jailbreaks',
    c4_title: 'Token Economy',
    c4_body: 'Stake reputation, earn LBH. Quality scales the multiplier.',
    c5_tag: '05 · GAME MODE',
    c5_diamond: 'DIAMOND',
    c5_league: 'league',
    c5_streak: 'day streak',
    c5_rank: 'RANK',
    c5_xp: 'XP',
    c5_mult: 'MULT',
    c5_title: 'Game Mode',
    c5_body: 'Daily challenges, leagues, streaks. Annotation as practice.',
    c6_tag: '06 · APPRENTICE MODE',
    c6_badge: 'your model · v0.12',
    c6_msg1:
      'Item <span class="lh-mono accent">#0421</span> — is this answer faithful?',
    c6_msg2: 'Partly. Step 3 is wrong but the final answer is right.',
    c6_msg3:
      'Noted. I’d score it <span class="lh-mono accent">2/4</span> on reasoning and <span class="lh-mono accent">4/4</span> on output. Same?',
    c6_msg4: 'Yes. Apply that pattern going forward.',
    c6_foot: 'learned 3 rules · this session',
    c6_title: 'Apprentice Mode',
    c6_body: 'A personal AI partner that learns your judgment over time.',
    tpl_closing:
      'Switch modes per task. Mix them per workspace. The rubric, the partner, and the trust score travel with you.',
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
      'LLM 时代的标注引擎。六种模式——问卷、双人、对战、代币、游戏、学徒——共用一套模型级评分。',
    cta_start: '创建工作区',
    cta_demo: '看它变聪明',
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
    tpl_h: '六种模式，一个引擎。选择你想要的教学形态。',
    tpl_all: '查看全部',
    c1_tag: '01 · 经典问卷',
    c1_badge: '847 题',
    c1_title: '经典问卷',
    c1_body: '多模型多题目的表格式评分。每格一个独立 checkbox，千行流畅。',
    c2_tag: '02 · 双人标注',
    c2_badge: '进行中',
    c2_title: '双人标注',
    c2_body:
      '和 Claude 协作标注。接受、修改、或反驳它的判断——记下每一次抉择的理由。',
    c3_tag: '03 · 模型对战',
    c3_wins: 'A 胜 · 64%',
    c3_b: 'B · 36%',
    c3_title: '模型对战',
    c3_body:
      'LMSYS 风格的双模型对战。选个赢家，写一句理由——评分维度自动浮现。',
    c4_tag: '04 · 代币经济',
    c4_badge: '今日 +128 LBH',
    c4_balance: 'LBH 余额',
    c4_l1: 'SFT · 医学问答',
    c4_l2: 'RLHF · 代码评审',
    c4_l3: '评测 · agent 轨迹',
    c4_l4: '红队 · 越狱测试',
    c4_title: '代币经济',
    c4_body: '押注信誉，赚取 LBH。质量越高，倍数越大。',
    c5_tag: '05 · 游戏模式',
    c5_diamond: '钻石',
    c5_league: '段位',
    c5_streak: '天连胜',
    c5_rank: '排名',
    c5_xp: '经验',
    c5_mult: '倍率',
    c5_title: '游戏模式',
    c5_body: '每日挑战、段位、连胜。把标注变成日常练习。',
    c6_tag: '06 · 学徒模式',
    c6_badge: '你的模型 · v0.12',
    c6_msg1:
      '题目 <span class="lh-mono accent">#0421</span> — 这个答案是否准确？',
    c6_msg2: '部分正确。第 3 步错了，但最终答案对。',
    c6_msg3:
      '记下了。我会给推理打 <span class="lh-mono accent">2/4</span>，输出 <span class="lh-mono accent">4/4</span>。一致吗？',
    c6_msg4: '一致。后续按这个模式来。',
    c6_foot: '本轮已学习 3 条规则',
    c6_title: '学徒模式',
    c6_body: '一个会随你成长的个人 AI 搭档。',
    tpl_closing: '按任务切换模式，按工作区组合。评分、搭档与信誉分随你迁移。',
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
