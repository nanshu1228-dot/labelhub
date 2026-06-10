import { type ReactNode } from "react";
import { summarizeSchema } from "./schema-summary";

/**
 * Prop-only presentational pieces for the Designer's metric strip and
 * the no-selection "schema inspector" pane. Extracted verbatim from
 * designer-shell.tsx — each receives all data via props and holds no
 * state of its own.
 */
export function DesignerMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--accent)" }}>{icon}</span>
        <span className="ts-11 mono" style={{ color: "var(--mute2)" }}>
          {label}
        </span>
      </div>
      <div
        className="mt-1 ts-18 mono"
        style={{ color: "var(--hi)", fontWeight: 650 }}
      >
        {value}
      </div>
    </div>
  );
}

export function SchemaInspector({
  stats,
  jsonSchemaPreview,
}: {
  stats: ReturnType<typeof summarizeSchema>;
  jsonSchemaPreview: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Root" value={String(stats.rootFields)} />
        <MiniStat label="Total" value={String(stats.fields)} />
        <MiniStat label="Containers" value={String(stats.containers)} />
        <MiniStat label="Rules" value={String(stats.rules)} />
      </div>
      <details open={stats.fields > 0}>
        <summary
          className="ts-12 mono cursor-pointer"
          style={{ color: "var(--text)" }}
        >
          JSON Schema
        </summary>
        <pre
          className="mt-2 rounded-md p-3 ts-11 mono"
          style={{
            maxHeight: 420,
            overflow: "auto",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            color: "var(--mute)",
            whiteSpace: "pre-wrap",
          }}
        >
          {jsonSchemaPreview}
        </pre>
      </details>
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded p-2"
      style={{ background: "var(--bg)", border: "1px solid var(--line)" }}
    >
      <div className="ts-10 mono" style={{ color: "var(--mute2)" }}>
        {label}
      </div>
      <div className="ts-13 mono mt-1" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}
