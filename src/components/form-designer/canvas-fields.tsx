"use client";

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FieldNode } from "@/lib/form-designer/schema";
import {
  MATERIALS,
  getMaterial,
  isContainerKind,
} from "@/components/form-materials/registry";
import { CHILD_MATERIALS } from "./palette-data";

/**
 * Recursive canvas field tree, extracted verbatim from designer-shell.tsx.
 *
 * Every component here is a prop-only leaf: the shell owns the schema
 * state, the root DndContext + SortableContext, the sensors, and the
 * drag-end handler, and passes the current selection + callbacks down.
 * SortableField's own `useSortable` is the per-item sortable binding it
 * has always carried — it is part of the moved subcomponent, not the
 * shell's DnD wiring.
 */
export function SortableField({
  field,
  selectedId,
  onSelect,
  onAddChild,
  activeTabBy,
  onSetActiveTab,
}: {
  field: FieldNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void;
  activeTabBy: Record<string, string>;
  onSetActiveTab: (layoutId: string, tabId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const mat = getMaterial(field.kind);
  const selected = field.id === selectedId;
  const isContainer = isContainerKind(field.kind);
  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(field.id);
      }}
      className="ts-13"
    >
      <div
        style={{
          background: selected ? "var(--accent-soft)" : "var(--panel)",
          border: `1px solid ${selected ? "var(--accent-line)" : "var(--line)"}`,
          borderRadius: 6,
          padding: "12px 14px",
          cursor: "pointer",
        }}
      >
        <div
          className="flex items-center gap-3 mb-2"
          {...attributes}
          {...listeners}
          style={{ cursor: "grab" }}
        >
          <span className="ts-11 mono" style={{ color: "var(--mute2)" }}>
            ⋮⋮
          </span>
          <span
            className="ts-13"
            style={{ color: "var(--text)", fontWeight: 500 }}
          >
            {field.label}
          </span>
          <span
            className="ts-11 mono ml-auto"
            style={{ color: "var(--mute2)" }}
          >
            {field.kind}
          </span>
        </div>
        {mat ? <mat.designerPreview field={field} /> : null}

        {isContainer ? (
          <ContainerChildren
            field={field}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            activeTabBy={activeTabBy}
            onSetActiveTab={onSetActiveTab}
          />
        ) : null}
      </div>
    </li>
  );
}

/**
 * Renders a container's children inline on the canvas. Each container
 * gets its own SortableContext keyed by the container's id so reorder
 * stays scoped to siblings.
 */
export function ContainerChildren({
  field,
  selectedId,
  onSelect,
  onAddChild,
  activeTabBy,
  onSetActiveTab,
}: {
  field: FieldNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void;
  activeTabBy: Record<string, string>;
  onSetActiveTab: (layoutId: string, tabId: string) => void;
}) {
  if (field.kind === "tab-layout") {
    const tabs = field.children ?? [];
    const activeTabId = activeTabBy[field.id] ?? tabs[0]?.id ?? null;
    const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    return (
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetActiveTab(field.id, t.id);
                onSelect(t.id);
              }}
              className="ts-12 mono px-2 py-1 rounded"
              style={{
                background:
                  active?.id === t.id ? "var(--accent-soft)" : "var(--panel2)",
                border: `1px solid ${active?.id === t.id ? "var(--accent-line)" : "var(--line)"}`,
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {t.label || t.id}
            </button>
          ))}
          {tabs.length === 0 ? (
            <span className="ts-11" style={{ color: "var(--mute2)" }}>
              No tabs.
            </span>
          ) : null}
        </div>
        {active ? (
          <NestedChildren
            parent={active}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            activeTabBy={activeTabBy}
            onSetActiveTab={onSetActiveTab}
          />
        ) : null}
      </div>
    );
  }

  return (
    <NestedChildren
      parent={field}
      selectedId={selectedId}
      onSelect={onSelect}
      onAddChild={onAddChild}
      activeTabBy={activeTabBy}
      onSetActiveTab={onSetActiveTab}
    />
  );
}

export function NestedChildren({
  parent,
  selectedId,
  onSelect,
  onAddChild,
  activeTabBy,
  onSetActiveTab,
}: {
  parent: FieldNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void;
  activeTabBy: Record<string, string>;
  onSetActiveTab: (layoutId: string, tabId: string) => void;
}) {
  const children = parent.children ?? [];
  return (
    <div
      className="mt-3 pl-3"
      style={{
        borderLeft: "2px solid var(--line)",
      }}
    >
      <SortableContext
        items={children.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2">
          {children.map((c) => (
            <SortableField
              key={c.id}
              field={c}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              activeTabBy={activeTabBy}
              onSetActiveTab={onSetActiveTab}
            />
          ))}
        </ul>
      </SortableContext>
      <AddChildBar parentId={parent.id} onAddChild={onAddChild} />
    </div>
  );
}

export function AddChildBar({
  parentId,
  onAddChild,
}: {
  parentId: string;
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void;
}) {
  return (
    <div
      className="mt-2 flex flex-wrap gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {CHILD_MATERIALS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onAddChild(parentId, k)}
          className="ts-11 mono px-2 py-1 rounded"
          style={{
            background: "var(--panel2)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            cursor: "pointer",
          }}
        >
          + {MATERIALS[k].name}
        </button>
      ))}
    </div>
  );
}
