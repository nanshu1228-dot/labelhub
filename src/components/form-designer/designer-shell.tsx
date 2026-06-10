"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  FileJson,
  LayoutDashboard,
  Layers,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
import type { FieldNode, FormSchema } from "@/lib/form-designer/schema";
import {
  appendChildTo,
  deleteField,
  formSchemaAtom,
  locateField,
  makeFieldFromKind,
  patchField,
  reorderSiblings,
  selectedFieldIdAtom,
  siblingsOf,
} from "./canvas-state";
import {
  MATERIALS,
  PALETTE_ORDER,
} from "@/components/form-materials/registry";
import { toJsonSchema } from "@/lib/form-designer/serialize";
import { getErrorMessage } from "@/lib/errors/client-utils";
import { PropertyPanel } from "./properties/property-panel";
import {
  EMPTY_DESIGNER_HISTORY,
  pushDesignerHistory,
  redoDesignerHistory,
  undoDesignerHistory,
  schemasEqual,
  type DesignerHistory,
} from "./history";
import { MATERIAL_DESCRIPTIONS } from "./palette-data";
import { findInTree, summarizeSchema } from "./schema-summary";
import {
  DesignerMetric,
  SchemaInspector,
} from "./schema-inspector";
import { SortableField } from "./canvas-fields";
import { AiSchemaButton } from "./ai-schema-button";

/**
 * Finals P1 D5 — Designer shell with nested SortableContext containers.
 *
 *   ┌─────────┬──────────────────┬──────────┐
 *   │ palette │   canvas (nest)  │ properties│
 *   │  D3 ✓   │   D5 group+tabs  │   D4/D5  │
 *   └─────────┴──────────────────┴──────────┘
 *
 * D5 deliverables met:
 *   - 11 palette buttons (D3 9 + group + tab-layout)
 *   - Containers render their children inline via a recursive
 *     SortableField, each wrapped in its own SortableContext so
 *     reorder works within the parent's scope
 *   - Cross-container drags are rejected — moving a field between
 *     parents arrives in D6 with a richer drag-state model
 *   - Property panel surfaces linkage (visibleWhen / requiredWhen)
 *     with sibling-aware dropdowns
 *   - Tab-layout previews active tab inline; tab switching is a
 *     designer-only ephemeral state (not persisted to formSchemaAtom)
 *
 * D6 fills in the runtime Renderer + server persistence into
 * custom_form_schemas.
 */
/**
 * Per-admin workspace option (passed from the server). Save targets one
 * workspace at a time; the picker shows label + id so the owner can
 * disambiguate two workspaces named the same.
 */
export interface DesignerWorkspaceOption {
  id: string;
  name: string;
}

/** Server actions invoked by the toolbar — kept loose so the shell stays client-only. */
export interface DesignerStorageActions {
  /** Create a new saved schema. Returns the row id for navigation. */
  save: (input: {
    workspaceId: string;
    label: string;
    schema: import("@/lib/form-designer/schema").FormSchema;
  }) => Promise<{ id: string }>;
  /**
   * Save a new version of an existing schema. Returns the NEW row's
   * { id, version } — caller can re-route to /admin/forms/[newId]
   * to keep editing the freshly-saved version.
   *
   * D21-B made this append-only: previously this mutated the row
   * in place; now it inserts a new row + bumps version, leaving the
   * prior id immutable so existing tasks keep rendering their
   * frozen schema.
   */
  update?: (input: {
    id: string;
    workspaceId: string;
    label: string;
    schema: import("@/lib/form-designer/schema").FormSchema;
  }) => Promise<{ id: string; version: number }>;
}

/**
 * Curated starter template displayed in the "Start from template"
 * dropdown. Shape mirrors a slice of the official template gallery
 * (src/lib/form-designer/templates) but the Designer keeps a
 * read-only view — pick one, the canvas hydrates from its schema.
 */
export interface DesignerTemplateOption {
  id: string;
  label: string;
  description: string;
  schema: import("@/lib/form-designer/schema").FormSchema;
}

export interface DesignerShellProps {
  /**
   * Workspaces the signed-in user can save into (admin role). When the
   * list has more than one, the Save dialog asks the owner to pick;
   * empty list disables the Save button (read-only Designer mode).
   */
  workspaces?: DesignerWorkspaceOption[];
  /**
   * Curated starter templates exposed via a dropdown above the
   * palette. Picking one replaces the current canvas; confirm
   * prompt fires if the canvas isn't empty so the PM doesn't
   * accidentally clobber in-progress work.
   */
  templates?: DesignerTemplateOption[];
  /**
   * Already-loaded schema to seed the canvas. Used by the edit
   * /admin/forms/[id] page; new-form page leaves this undefined so
   * the localStorage draft (atomWithStorage) takes over.
   */
  initialSchema?: {
    id: string;
    workspaceId: string;
    label: string;
    version?: number;
    schema: import("@/lib/form-designer/schema").FormSchema;
  };
  /** Server actions; absent on the read-only preview embed. */
  storage?: DesignerStorageActions;
  /** Path to navigate to after save (default /admin/forms). */
  postSaveHref?: string;
}

export function DesignerShell({
  workspaces = [],
  templates = [],
  initialSchema,
  storage,
  postSaveHref = "/admin/forms",
}: DesignerShellProps = {}) {
  const [schema, setSchema] = useAtom(formSchemaAtom);
  const [selectedId, setSelectedId] = useAtom(selectedFieldIdAtom);
  /** Map tab-layout id → currently focused tab id (designer-only UI state). */
  const [activeTabBy, setActiveTabBy] = useState<Record<string, string>>({});
  const [schemaLabel, setSchemaLabel] = useState(
    initialSchema?.label ?? "Untitled form",
  );
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(
    initialSchema?.workspaceId ?? workspaces[0]?.id ?? "",
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [history, setHistory] = useState<DesignerHistory>(
    EMPTY_DESIGNER_HISTORY,
  );
  const [savePending, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();

  /** Hydrate from the server-provided schema once (edit mode). */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current && initialSchema) {
      hydratedRef.current = true;
      setSchema(initialSchema.schema);
      setHistory(EMPTY_DESIGNER_HISTORY);
    }
  }, [initialSchema, setSchema]);

  const schemaStats = useMemo(
    () => summarizeSchema(schema.fields),
    [schema.fields],
  );
  const jsonSchemaPreview = useMemo(
    () =>
      JSON.stringify(
        toJsonSchema(schema, {
          title: schemaLabel.trim() || "Untitled form",
        }),
        null,
        2,
      ),
    [schema, schemaLabel],
  );
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Tiny activation threshold so a click doesn't accidentally drag.
      activationConstraint: { distance: 4 },
    }),
  );

  function commitSchema(
    buildNext: (current: FormSchema) => FormSchema,
    noticeText?: string,
  ) {
    const next = buildNext(schema);
    if (schemasEqual(schema, next)) return;
    setHistory((current) => pushDesignerHistory(current, schema, next));
    setSchema(next);
    setResetArmed(false);
    if (noticeText !== undefined) setNotice(noticeText);
  }

  function undoSchema() {
    const result = undoDesignerHistory(history, schema);
    if (!result) return;
    setHistory(result.history);
    setSchema(result.schema);
    if (selectedId && !locateField(result.schema.fields, selectedId)) {
      setSelectedId(null);
    }
    setResetArmed(false);
    setNotice("Undid the last canvas change.");
  }

  function redoSchema() {
    const result = redoDesignerHistory(history, schema);
    if (!result) return;
    setHistory(result.history);
    setSchema(result.schema);
    if (selectedId && !locateField(result.schema.fields, selectedId)) {
      setSelectedId(null);
    }
    setResetArmed(false);
    setNotice("Redid the canvas change.");
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    commitSchema((current) => reorderSiblings(current, activeId, overId));
  }

  function addMaterial(kind: keyof typeof MATERIALS) {
    const mat = MATERIALS[kind];
    const field = makeFieldFromKind(kind, mat.defaultConfig, mat.name);
    commitSchema((c) => ({ ...c, fields: [...c.fields, field] }));
    setSelectedId(field.id);
    setNotice(null);
  }

  function patchSelectedField(next: FieldNode) {
    commitSchema((c) => patchField(c, next));
  }

  function deleteSelectedField() {
    if (!selectedId) return;
    commitSchema((c) => deleteField(c, selectedId), "Field deleted.");
    setSelectedId(null);
  }

  function resetCanvas() {
    if (!resetArmed && schema.fields.length > 0) {
      setResetArmed(true);
      setNotice("Press reset once more to clear the canvas.");
      return;
    }
    commitSchema(() => ({ version: 1, fields: [] }), "Canvas cleared.");
    setSelectedId(null);
  }

  /**
   * Add a child to a specific container. Used by the in-canvas
   * "+ Add field" affordance on each group / tab.
   */
  function addChildTo(parentId: string, kind: keyof typeof MATERIALS) {
    const mat = MATERIALS[kind];
    const field = makeFieldFromKind(kind, mat.defaultConfig, mat.name);
    commitSchema((c) => appendChildTo(c, parentId, field));
    setSelectedId(field.id);
  }

  function setActiveTab(layoutId: string, tabId: string) {
    setActiveTabBy((m) => ({ ...m, [layoutId]: tabId }));
  }

  function applyTemplate() {
    if (!selectedTemplate) return;
    commitSchema(() => selectedTemplate.schema, `Loaded ${selectedTemplate.label}.`);
    setSelectedId(null);
    setSelectedTemplateId("");
    setSaveError(null);
  }

  /** Persist the current canvas state through the parent-provided action. */
  function saveSchema() {
    if (!storage || workspaces.length === 0) return;
    if (schema.fields.length === 0) {
      setSaveError("Add at least one field before saving.");
      return;
    }
    const label = schemaLabel.trim();
    if (!label.trim()) {
      setSaveError("Name this schema before saving.");
      return;
    }
    const workspaceId = initialSchema?.workspaceId ?? targetWorkspaceId;
    if (!workspaceId) {
      setSaveError("Choose a workspace before saving.");
      return;
    }
    setSaveError(null);
    setNotice(null);
    startSave(async () => {
      try {
        if (initialSchema && storage.update) {
          // D21-B — update is now append-only; it returns the NEW
          // row's id. Navigate to /admin/forms/[newId] so the
          // PM keeps editing the freshest version (the old row
          // remains intact for any pinned tasks).
          const next = await storage.update({
            id: initialSchema.id,
            workspaceId: workspaceId!,
            label,
            schema,
          });
          if (next.id !== initialSchema.id) {
            router.push(`/admin/forms/${next.id}`);
          } else {
            router.refresh();
          }
        } else {
          await storage.save({
            workspaceId: workspaceId!,
            label,
            schema,
          });
          router.push(postSaveHref);
        }
      } catch (err) {
        setSaveError(getErrorMessage(err, "Save failed."));
      }
    });
  }

  const selectedField =
    selectedId === null
      ? null
      : locateField(schema.fields, selectedId)
        ? findInTree(schema.fields, selectedId)
        : null;

  const siblings = selectedId == null ? [] : siblingsOf(schema, selectedId);

  return (
    <div
      className="lh-designer-grid"
      style={{
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <style>{`
        /* Designer responsive grid — D20-B.
         * Desktop (≥1280px): classic 3-column (palette / canvas / properties).
         * Tablet (1024-1279px): 2-column (palette + canvas); properties moves
         *   under the canvas as a stacked panel.
         * Narrow (<1024px): single column; palette becomes a horizontal
         *   chip-row at the top; properties stays under the canvas.
         * Heights collapse to min-content under 1024px so the page
         *   scrolls instead of forcing internal scroll inside aside panes.
         */
        .lh-designer-grid {
          display: grid;
          min-height: 100vh;
          grid-template-columns: 1fr;
          grid-template-areas:
            'palette'
            'canvas'
            'properties';
        }
        .lh-designer-grid > [data-region='palette'] {
          grid-area: palette;
          max-height: 220px;
          overflow-x: auto;
          overflow-y: auto;
        }
        .lh-designer-grid > [data-region='canvas'] {
          grid-area: canvas;
          min-height: 480px;
        }
        .lh-designer-grid > [data-region='properties'] {
          grid-area: properties;
          max-height: 60vh;
        }
        @media (min-width: 1024px) {
          .lh-designer-grid {
            grid-template-columns: 240px minmax(0, 1fr);
            grid-template-rows: 1fr;
            grid-template-areas:
              'palette canvas'
              'palette properties';
            height: 100vh;
          }
          .lh-designer-grid > [data-region='palette'] {
            max-height: none;
            overflow-x: visible;
            overflow-y: auto;
          }
          .lh-designer-grid > [data-region='canvas'] {
            overflow-y: auto;
          }
          .lh-designer-grid > [data-region='properties'] {
            max-height: 50vh;
            overflow-y: auto;
          }
        }
        @media (min-width: 1280px) {
          .lh-designer-grid {
            grid-template-columns: 240px minmax(0, 1fr) 320px;
            grid-template-areas: 'palette canvas properties';
          }
          .lh-designer-grid > [data-region='properties'] {
            max-height: none;
          }
        }
      `}</style>
      <aside
        data-region="palette"
        className="border-r p-4"
        style={{ borderColor: "var(--line)", background: "var(--panel)" }}
      >
        <div className="mb-5">
          <div className="lbl" style={{ color: "var(--mute)" }}>
            DESIGNER
          </div>
          <h2
            className="mt-1"
            style={{ color: "var(--hi)", fontSize: 20, fontWeight: 650 }}
          >
            Form builder
          </h2>
        </div>
        {templates.length > 0 ? (
          <div
            className="mb-5 flex flex-col gap-2 rounded-md p-3"
            style={{ background: "var(--bg)", border: "1px solid var(--line)" }}
          >
            <label
              className="lbl"
              style={{ color: "var(--mute)" }}
              htmlFor="lh-template-picker"
            >
              TEMPLATE
            </label>
            <select
              id="lh-template-picker"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="ts-13"
              style={{
                background: "var(--panel2)",
                border: "1px solid var(--line)",
                color: "var(--text)",
                borderRadius: 4,
                padding: "6px 8px",
              }}
            >
              <option value="">— pick a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id} title={t.description}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyTemplate}
              disabled={!selectedTemplate}
              className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
              style={{
                minHeight: 32,
                background: selectedTemplate
                  ? "var(--accent)"
                  : "var(--panel2)",
                color: selectedTemplate ? "white" : "var(--mute2)",
                border: "1px solid var(--accent-line)",
                cursor: selectedTemplate ? "pointer" : "not-allowed",
              }}
            >
              <LayoutDashboard size={13} />
              Apply template
            </button>
          </div>
        ) : null}
        {(initialSchema?.workspaceId ?? targetWorkspaceId) ? (
          <AiSchemaButton
            workspaceId={initialSchema?.workspaceId ?? targetWorkspaceId}
            onSchema={(s, summary) => {
              commitSchema(
                () => s,
                `AI 已按「${summary}」生成表单 —— 已载入画布,保存前可改。`,
              );
              setSelectedId(null);
            }}
          />
        ) : null}
        <div className="lbl mb-3" style={{ color: "var(--mute)" }}>
          MATERIALS
        </div>
        <div className="flex flex-col gap-1.5">
          {PALETTE_ORDER.map((kind) => {
            const mat = MATERIALS[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addMaterial(kind)}
                className="text-left px-3 py-2 rounded inline-flex items-center gap-2"
                style={{
                  background: "var(--panel2)",
                  border: "1px solid var(--line)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                <span
                  className="inline-block w-6 text-center"
                  style={{ color: "oklch(0.6 0.18 280)" }}
                >
                  {mat.icon}
                </span>
                <span className="min-w-0">
                  <span
                    className="block ts-13 mono"
                    style={{ color: "var(--text)" }}
                  >
                    {mat.name}
                  </span>
                  <span
                    className="block ts-11"
                    style={{ color: "var(--mute2)" }}
                  >
                    {MATERIAL_DESCRIPTIONS[kind]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main data-region="canvas" className="p-6">
        <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="lbl" style={{ color: "var(--mute)" }}>
              DESIGNER WORKBENCH
            </div>
            <input
              value={schemaLabel}
              onChange={(e) => setSchemaLabel(e.target.value)}
              className="mt-1 w-full"
              style={{
                color: "var(--hi)",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--line)",
                fontSize: 30,
                lineHeight: 1.15,
                fontWeight: 650,
                outline: "none",
                padding: "3px 0 8px",
              }}
              aria-label="Schema name"
            />
          </div>
          <div
            className="grid gap-2 sm:grid-cols-[220px_auto] xl:min-w-[520px]"
            style={{ alignSelf: "end" }}
          >
            <label className="flex flex-col gap-1">
              <span className="ts-11 mono" style={{ color: "var(--mute2)" }}>
                WORKSPACE
              </span>
              <select
                value={initialSchema?.workspaceId ?? targetWorkspaceId}
                onChange={(e) => setTargetWorkspaceId(e.target.value)}
                disabled={Boolean(initialSchema)}
                className="ts-13"
                style={{
                  minHeight: 38,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  color: "var(--text)",
                  borderRadius: 6,
                  padding: "7px 10px",
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              {storage && workspaces.length > 0 ? (
                <button
                  type="button"
                  onClick={saveSchema}
                  disabled={savePending || schema.fields.length === 0}
                  className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
                  style={{
                    minHeight: 38,
                    background:
                      savePending || schema.fields.length === 0
                        ? "var(--panel2)"
                        : "var(--accent)",
                    color:
                      savePending || schema.fields.length === 0
                        ? "var(--mute2)"
                        : "white",
                    border: "1px solid var(--accent-line)",
                    cursor:
                      savePending || schema.fields.length === 0
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  <Save size={14} />
                  {savePending
                    ? "Saving"
                    : initialSchema
                      ? "Save version"
                      : "Save schema"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={undoSchema}
                disabled={history.past.length === 0}
                className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
                style={{
                  minHeight: 38,
                  background:
                    history.past.length === 0 ? "var(--panel2)" : "transparent",
                  color:
                    history.past.length === 0 ? "var(--mute2)" : "var(--text)",
                  border: "1px solid var(--line)",
                  cursor: history.past.length === 0 ? "not-allowed" : "pointer",
                }}
                title="Undo last canvas change"
                aria-label="Undo last canvas change"
              >
                <Undo2 size={14} />
                Undo
              </button>
              <button
                type="button"
                onClick={redoSchema}
                disabled={history.future.length === 0}
                className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
                style={{
                  minHeight: 38,
                  background:
                    history.future.length === 0 ? "var(--panel2)" : "transparent",
                  color:
                    history.future.length === 0 ? "var(--mute2)" : "var(--text)",
                  border: "1px solid var(--line)",
                  cursor:
                    history.future.length === 0 ? "not-allowed" : "pointer",
                }}
                title="Redo canvas change"
                aria-label="Redo canvas change"
              >
                <Undo2 size={14} style={{ transform: "scaleX(-1)" }} />
                Redo
              </button>
              {schema.fields.length > 0 && (
                <button
                  type="button"
                  onClick={resetCanvas}
                  className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
                  style={{
                    minHeight: 38,
                    background: resetArmed
                      ? "oklch(0.55 0.2 25 / 0.08)"
                      : "transparent",
                    color: resetArmed ? "var(--danger)" : "var(--mute)",
                    border: "1px solid oklch(0.55 0.2 25 / 0.4)",
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mb-5 grid gap-2 md:grid-cols-4">
          <DesignerMetric
            icon={<Layers size={15} />}
            label="Fields"
            value={String(schemaStats.fields)}
          />
          <DesignerMetric
            icon={<Sparkles size={15} />}
            label="LLM"
            value={String(schemaStats.llm)}
          />
          <DesignerMetric
            icon={<Workflow size={15} />}
            label="Rules"
            value={String(schemaStats.rules)}
          />
          <DesignerMetric
            icon={<FileJson size={15} />}
            label={initialSchema?.version ? "Saved" : "Schema"}
            value={`v${initialSchema?.version ?? schema.version}`}
          />
        </div>

        {(saveError || notice) && (
          <div
            className="mb-4 rounded-md px-3 py-2 ts-12"
            style={{
              background: saveError ? "var(--danger-soft)" : "var(--panel)",
              border: `1px solid ${saveError ? "oklch(0.55 0.2 25 / 0.35)" : "var(--line)"}`,
              color: saveError ? "var(--danger)" : "var(--mute)",
            }}
          >
            {saveError ?? notice}
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="lbl" style={{ color: "var(--mute)" }}>
            CANVAS
          </div>
          <div className="ts-11 mono" style={{ color: "var(--mute2)" }}>
            {schemaStats.fields === 0
              ? "EMPTY"
              : `${schemaStats.rootFields} root / ${schemaStats.fields} total`}
          </div>
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={schema.fields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-3">
              {schema.fields.map((f) => (
                <SortableField
                  key={f.id}
                  field={f}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAddChild={addChildTo}
                  activeTabBy={activeTabBy}
                  onSetActiveTab={setActiveTab}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {schema.fields.length === 0 && (
          <div
            className="rounded-md p-12 text-center ts-13 mt-4"
            style={{
              background: "var(--panel)",
              border: "1px dashed var(--line)",
              color: "var(--mute2)",
            }}
          >
            No fields yet.
          </div>
        )}
      </main>

      <aside
        data-region="properties"
        className="border-l p-4"
        style={{ borderColor: "var(--line)", background: "var(--panel)" }}
      >
        <div className="lbl mb-3" style={{ color: "var(--mute)" }}>
          PROPERTIES
        </div>
        {selectedField ? (
          <PropertyPanel
            field={selectedField}
            siblings={siblings}
            onChange={patchSelectedField}
            onDelete={deleteSelectedField}
          />
        ) : (
          <SchemaInspector
            stats={schemaStats}
            jsonSchemaPreview={jsonSchemaPreview}
          />
        )}
      </aside>
    </div>
  );
}
