"use client";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { DEMO_WORKSPACE_PATH } from "@/lib/seeds";

/**
 * Landing hero — finals-facing platform overview.
 *
 * Simplified, white, low-noise: a single calm column with the headline,
 * two CTAs, three live stats, a flat 6-step pipeline strip, and the three
 * role cards. The old interactive PlatformBoard mockup + marketing guardrail
 * box were removed to keep the first screen clean and fast.
 */

export interface HeroStats {
  trajectoriesCaptured: number;
  teachingSignals: number;
  workspaceCount: number;
  toolCallsCaptured: number;
}

function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function Hero({ stats }: { stats: HeroStats | null }) {
  const { lang } = useLang();
  const copy = HERO_COPY[lang];
  return (
    <section id="platform" className="app-light">
      <div className="max-w-[1100px] mx-auto px-6 pt-24 pb-16">
        <div
          className="lh-caption flex items-center gap-2"
          style={{
            color: "var(--mute)",
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--accent)",
              boxShadow: "0 0 0 3px var(--accent-soft)",
            }}
          />
          <span>{copy.eyebrow}</span>
        </div>

        <h1
          className="mt-6 max-w-[820px]"
          style={
            {
              color: "var(--hi)",
              fontSize: 48,
              lineHeight: 1.05,
              fontWeight: 650,
              textWrap: "balance",
            } as React.CSSProperties
          }
        >
          {copy.title}
        </h1>

        <p
          className="ts-15 mt-5 max-w-[620px]"
          style={{ color: "var(--mute)", lineHeight: 1.65 }}
        >
          {copy.sub}
        </p>

        <div className="mt-8 flex items-center gap-3 flex-wrap">
          <Link
            href="/admin"
            className="lh-btn lh-btn-accent"
            style={{ height: 42, padding: "0 18px", textDecoration: "none" }}
          >
            {copy.primaryCta}
          </Link>
          <Link
            href={DEMO_WORKSPACE_PATH}
            className="lh-btn lh-btn-ghost"
            style={{ height: 42, padding: "0 16px", textDecoration: "none" }}
          >
            {copy.secondaryCta}
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-3 max-w-[520px]">
          {[
            { label: copy.stats.workspaces, value: stats?.workspaceCount },
            { label: copy.stats.trajectories, value: stats?.trajectoriesCaptured },
            { label: copy.stats.teaching, value: stats?.teachingSignals },
          ].map((item) => (
            <div key={item.label} className="lh-card px-3.5 py-2.5">
              <div
                className="ts-18"
                style={{
                  color: "var(--hi)",
                  fontWeight: 650,
                  fontFeatureSettings: '"tnum"',
                }}
              >
                {item.value == null ? "—" : compactNum(item.value)}
              </div>
              <div className="ts-11 mt-0.5" style={{ color: "var(--mute2)" }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>

        {/* Flat pipeline strip — the end-to-end flow, no animation/mockup. */}
        <div className="mt-14">
          <div className="lbl mb-3">{copy.boardLabel}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {copy.pipeline.map((step, i) => (
              <div key={step.title} className="lh-card p-3.5">
                <div
                  className="ts-11 inline-flex items-center justify-center"
                  style={{
                    color: "var(--accent)",
                    fontWeight: 600,
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: "var(--accent-soft)",
                  }}
                >
                  {i + 1}
                </div>
                <div className="ts-13 mt-2" style={{ color: "var(--hi)", fontWeight: 600 }}>
                  {step.title}
                </div>
                <div className="ts-11 mt-1" style={{ color: "var(--mute)" }}>
                  {step.meta}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-3">
          {copy.roleCards.map((card) => (
            <RoleCard key={card.title} {...card} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RoleCard({
  role,
  title,
  body,
}: {
  role: string;
  title: string;
  body: string;
}) {
  return (
    <div className="lh-card p-5">
      <div
        className="ts-11"
        style={{
          color: "var(--accent)",
          fontWeight: 600,
          letterSpacing: "0.06em",
        }}
      >
        {role}
      </div>
      <div className="ts-15 mt-2" style={{ color: "var(--hi)", fontWeight: 650 }}>
        {title}
      </div>
      <p className="ts-12 mt-2" style={{ color: "var(--mute)", lineHeight: 1.55 }}>
        {body}
      </p>
    </div>
  );
}

type HeroCopy = {
  eyebrow: string;
  title: string;
  sub: string;
  primaryCta: string;
  secondaryCta: string;
  stats: {
    workspaces: string;
    trajectories: string;
    teaching: string;
  };
  boardLabel: string;
  pipeline: Array<{ title: string; meta: string }>;
  roleCards: Array<{ role: string; title: string; body: string }>;
};

const HERO_COPY: Record<"en" | "zh", HeroCopy> = {
  en: {
    eyebrow: "LabelHub · data production cockpit",
    title:
      "Build labeling tasks, pre-review with AI, and export clean datasets.",
    sub: "One workspace for the complete flow: task publishing, visual form design, labeler workbench, AI review, human acceptance, and reproducible exports.",
    primaryCta: "Open admin cockpit",
    secondaryCta: "Tour demo workspace",
    stats: {
      workspaces: "workspaces",
      trajectories: "trajectories",
      teaching: "teaching signals",
    },
    boardLabel: "END-TO-END FLOW",
    pipeline: [
      { title: "Publish task", meta: "draft / open / paused" },
      { title: "Import data", meta: "JSONL / CSV / Excel" },
      { title: "Label workbench", meta: "autosave + validation" },
      { title: "AI pre-review", meta: "scores + verdict" },
      { title: "Human review", meta: "pass / send back" },
      { title: "Export dataset", meta: "JSONL / CSV / Excel" },
    ],
    roleCards: [
      {
        role: "OWNER",
        title: "Task publishing without hidden setup",
        body: "Create schema-driven tasks, import datasets, assign rows, and publish from one cockpit.",
      },
      {
        role: "LABELER",
        title: "A focused workbench for throughput",
        body: "Claim items, autosave drafts, use field-level AI help, and see revision feedback.",
      },
      {
        role: "REVIEWER",
        title: "AI signal plus accountable human decisions",
        body: "Review queues include AI scores, diff history, batch actions, and audit trails.",
      },
    ],
  },
  zh: {
    eyebrow: "LabelHub · 数据生产工作台",
    title: "创建标注任务，AI 预审，人审确认，再导出干净数据集。",
    sub: "一个工作区串起完整流程：任务发布、可视化表单设计、标注工作台、AI 审核、人类复核、可复现导出。",
    primaryCta: "进入管理工作台",
    secondaryCta: "查看演示工作区",
    stats: {
      workspaces: "工作区",
      trajectories: "轨迹",
      teaching: "教学信号",
    },
    boardLabel: "端到端流程",
    pipeline: [
      { title: "发布任务", meta: "草稿 / 开放 / 暂停" },
      { title: "导入数据", meta: "JSONL / CSV / Excel" },
      { title: "标注工作台", meta: "自动保存 + 校验" },
      { title: "AI 预审", meta: "维度分 + 裁决" },
      { title: "人工复核", meta: "通过 / 打回" },
      { title: "导出数据集", meta: "JSONL / CSV / Excel" },
    ],
    roleCards: [
      {
        role: "OWNER",
        title: "不用绕路的任务发布",
        body: "表单、数据导入、分配和发布收在一个管理入口里。",
      },
      {
        role: "LABELER",
        title: "面向吞吐的标注工作台",
        body: "领取题目、自动保存、字段级 AI 辅助，并能看到打回反馈。",
      },
      {
        role: "REVIEWER",
        title: "AI 信号加可追责人审",
        body: "审核队列包含 AI 分数、差异历史、批量操作和审计记录。",
      },
    ],
  },
};
