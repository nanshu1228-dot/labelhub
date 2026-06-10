'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useMemo, useState, useTransition } from 'react'
import {
  CheckCircle2,
  DatabaseZap,
  ExternalLink,
  Eye,
  FilePenLine,
  Flag,
  Loader2,
  ShieldCheck,
  Square,
  SquareCheck,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import {
  batchPatchTopicItemData,
  type BatchPatchTopicItemDataResult,
} from '@/lib/actions/topics'
import type { listTopicsInTask } from '@/lib/queries/topics'
import { getErrorMessage } from '@/lib/errors/client-utils'

type TopicRow = Awaited<ReturnType<typeof listTopicsInTask>>[number]

export function TopicRosterManager({
  workspaceId,
  taskId,
  topics,
  canReview,
  canManage,
}: {
  workspaceId: string
  taskId: string
  topics: TopicRow[]
  canReview: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeTopicId, setActiveTopicId] = useState<string | null>(
    topics[0]?.id ?? null,
  )
  const [patchJson, setPatchJson] = useState('{\n  "source": "batch-1"\n}')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] =
    useState<BatchPatchTopicItemDataResult | null>(null)
  const [pending, startTransition] = useTransition()

  const editableIds = useMemo(
    () => topics.filter(isBatchEditable).map((topic) => topic.id),
    [topics],
  )
  const selectedTopics = useMemo(
    () => topics.filter((topic) => selected.has(topic.id)),
    [topics, selected],
  )
  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === activeTopicId) ?? topics[0],
    [topics, activeTopicId],
  )
  const allEditableSelected =
    editableIds.length > 0 && editableIds.every((id) => selected.has(id))

  function toggleOne(topic: TopicRow) {
    if (!isBatchEditable(topic)) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(topic.id)) next.delete(topic.id)
      else next.add(topic.id)
      return next
    })
  }

  function toggleAllEditable() {
    setSelected((current) => {
      const next = new Set(current)
      if (allEditableSelected) {
        for (const id of editableIds) next.delete(id)
      } else {
        for (const id of editableIds) next.add(id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
    setError(null)
    setResult(null)
  }

  function applyPatch() {
    setError(null)
    setResult(null)
    if (selectedTopics.length === 0) return

    let patch: unknown
    try {
      patch = JSON.parse(patchJson)
    } catch (e) {
      setError(getErrorMessage(e, 'Invalid JSON.'))
      return
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      setError('Patch must be a JSON object.')
      return
    }

    startTransition(async () => {
      try {
        const next = await batchPatchTopicItemData({
          taskId,
          topicIds: selectedTopics.map((topic) => topic.id),
          patch: patch as Record<string, unknown>,
        })
        setResult(next)
        if (next.updated.length > 0) {
          setSelected(new Set())
          router.refresh()
        }
      } catch (e) {
        setError(getErrorMessage(e, 'Batch edit failed.'))
      }
    })
  }

  return (
    <section
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="lbl">TOPIC ROSTER</div>
          <h2
            className="ts-16 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 560 }}
          >
            Dataset manager
          </h2>
          <p
            className="ts-12 mt-1 max-w-[680px]"
            style={{ color: 'var(--mute2)' }}
          >
            Preview imported rows, inspect the raw payload, and batch-edit
            unassigned drafting topics.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            {topics.length} total
          </span>
          {canManage && topics.length > 0 ? (
            <button
              type="button"
              onClick={toggleAllEditable}
              disabled={editableIds.length === 0}
              className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
              style={ghostButtonStyle}
            >
              {allEditableSelected ? (
                <SquareCheck size={14} />
              ) : (
                <Square size={14} />
              )}
              Select drafts
            </button>
          ) : null}
        </div>
      </div>

      {canManage && selected.size > 0 ? (
        <BatchEditPanel
          selectedCount={selected.size}
          patchJson={patchJson}
          setPatchJson={setPatchJson}
          pending={pending}
          error={error}
          result={result}
          onApply={applyPatch}
          onClear={clearSelection}
        />
      ) : null}

      {topics.length === 0 ? (
        <div
          className="mt-4 rounded px-4 py-8 text-center ts-13"
          style={{
            background: 'var(--bg)',
            border: '1px dashed var(--line2)',
            color: 'var(--mute2)',
          }}
        >
          <UploadCloud className="mx-auto mb-2" size={20} />
          No topics yet. Import data before publishing the task.
        </div>
      ) : (
        <>
          <div
            className="mt-4"
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table
              className="ts-13"
              style={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                width: '100%',
                minWidth: 820,
              }}
            >
              <thead>
                <tr>
                  {canManage ? <Th width={48} /> : null}
                  <Th>Topic Preview</Th>
                  <Th width={150}>Stage</Th>
                  <Th width={170}>Assigned</Th>
                  <Th width={120}>Created</Th>
                  <Th width={112}>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {topics.map((topic) => {
                  const editable = isBatchEditable(topic)
                  return (
                    <tr key={topic.id}>
                      {canManage ? (
                        <Td>
                          <button
                            type="button"
                            onClick={() => toggleOne(topic)}
                            disabled={!editable}
                            aria-label={
                              selected.has(topic.id)
                                ? 'Unselect topic'
                                : 'Select topic'
                            }
                            title={
                              editable
                                ? 'Select for batch edit'
                                : 'Only unassigned drafting topics can be edited'
                            }
                            className="inline-flex items-center justify-center rounded"
                            style={{
                              width: 32,
                              height: 32,
                              background: 'transparent',
                              border: '1px solid var(--line)',
                              color: editable
                                ? 'var(--accent)'
                                : 'var(--mute2)',
                              cursor: editable ? 'pointer' : 'not-allowed',
                              opacity: editable ? 1 : 0.55,
                            }}
                          >
                            {selected.has(topic.id) ? (
                              <SquareCheck size={16} />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </Td>
                      ) : null}
                      <Td>
                        <button
                          type="button"
                          onClick={() => setActiveTopicId(topic.id)}
                          className="block w-full text-left"
                          style={{
                            color: 'inherit',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          <span style={{ color: 'var(--text)' }}>
                            {formatTopicPreview(topic.itemData)}
                          </span>
                          <span
                            className="ts-11 mono mt-1 block"
                            style={{ color: 'var(--mute2)' }}
                          >
                            {topic.id.slice(0, 8)}
                          </span>
                        </button>
                      </Td>
                      <Td>
                        <WorkflowBadge status={topic.status} />
                      </Td>
                      <Td>
                        <span
                          className="ts-12 mono"
                          style={{ color: 'var(--mute2)' }}
                        >
                          {topic.assignedTo
                            ? topic.assignedTo.slice(0, 8)
                            : 'Unassigned'}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="ts-12 mono"
                          style={{ color: 'var(--mute2)' }}
                        >
                          {formatDate(topic.createdAt)}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setActiveTopicId(topic.id)}
                            aria-label="Preview topic"
                            title="Preview topic"
                            className="inline-flex items-center justify-center rounded"
                            style={iconButtonStyle}
                          >
                            <Eye size={14} />
                          </button>
                          <Link
                            href={`/workspaces/${workspaceId}/topics/${topic.id}/annotate`}
                            aria-label={
                              canReview
                                ? 'Inspect annotation room'
                                : 'Open annotation room'
                            }
                            title={canReview ? 'Inspect' : 'Annotate'}
                            className="inline-flex items-center justify-center rounded"
                            style={iconButtonStyle}
                          >
                            <ExternalLink size={14} />
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {activeTopic ? (
            <TopicPreviewPanel
              topic={activeTopic}
              workspaceId={workspaceId}
              canReview={canReview}
              onClose={() => setActiveTopicId(null)}
            />
          ) : null}
        </>
      )}
    </section>
  )
}

function BatchEditPanel({
  selectedCount,
  patchJson,
  setPatchJson,
  pending,
  error,
  result,
  onApply,
  onClear,
}: {
  selectedCount: number
  patchJson: string
  setPatchJson: (value: string) => void
  pending: boolean
  error: string | null
  result: BatchPatchTopicItemDataResult | null
  onApply: () => void
  onClear: () => void
}) {
  return (
    <div
      className="mt-4 rounded p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--accent-line)',
      }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div
            className="ts-12 mono inline-flex items-center gap-2"
            style={{ color: 'var(--accent)', fontWeight: 600 }}
          >
            <FilePenLine size={14} />
            BATCH DATA PATCH
          </div>
          <div className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
            Null removes a key; every patched row is template-validated.
          </div>
        </div>
        <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {selectedCount} selected
        </div>
      </div>
      <textarea
        value={patchJson}
        onChange={(event) => setPatchJson(event.target.value)}
        rows={4}
        maxLength={32000}
        spellCheck={false}
        className="ts-12 mono mt-3 w-full rounded px-3 py-2"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          outline: 'none',
          resize: 'vertical',
        }}
      />
      {error ? <Message tone="danger">{error}</Message> : null}
      {result ? (
        <Message tone={result.failed.length > 0 ? 'warning' : 'success'}>
          Updated {result.updated.length}; skipped {result.skipped.length};
          failed {result.failed.length}.
        </Message>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClear}
          disabled={pending}
          className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
          style={ghostButtonStyle}
        >
          <X size={14} />
          Clear
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={pending || !patchJson.trim()}
          className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
          style={{
            minHeight: 40,
            background:
              pending || !patchJson.trim()
                ? 'var(--panel2)'
                : 'var(--accent)',
            color: pending || !patchJson.trim() ? 'var(--mute2)' : 'white',
            border: '1px solid var(--accent-line)',
            cursor: pending || !patchJson.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <DatabaseZap size={14} />
          )}
          Apply patch
        </button>
      </div>
    </div>
  )
}

function TopicPreviewPanel({
  topic,
  workspaceId,
  canReview,
  onClose,
}: {
  topic: TopicRow
  workspaceId: string
  canReview: boolean
  onClose: () => void
}) {
  return (
    <div
      className="mt-4 rounded p-4"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="lbl">TOPIC PREVIEW</div>
          <h3
            className="ts-16 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 560 }}
          >
            {formatTopicPreview(topic.itemData)}
          </h3>
          <div className="ts-11 mono mt-1" style={{ color: 'var(--mute2)' }}>
            {topic.id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/workspaces/${workspaceId}/topics/${topic.id}/annotate`}
            className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
            style={ghostButtonStyle}
          >
            <ExternalLink size={14} />
            {canReview ? 'Inspect' : 'Annotate'}
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview"
            className="inline-flex items-center justify-center rounded"
            style={iconButtonStyle}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <PreviewFact label="Stage" value={formatWorkflowStatus(topic.status)} />
        <PreviewFact
          label="Assigned"
          value={topic.assignedTo ? topic.assignedTo.slice(0, 8) : 'Open'}
        />
        <PreviewFact label="Created" value={formatDate(topic.createdAt)} />
      </div>
      <pre
        className="ts-12 mono mt-4 rounded p-3"
        style={{
          maxHeight: 360,
          overflow: 'auto',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {safeStringify(topic.itemData)}
      </pre>
    </div>
  )
}

function Message({
  tone,
  children,
}: {
  tone: 'danger' | 'warning' | 'success'
  children: ReactNode
}) {
  const style =
    tone === 'danger'
      ? {
          background: 'var(--danger-soft)',
          border: '1px solid oklch(0.55 0.2 25 / 0.35)',
          color: 'var(--danger)',
        }
      : tone === 'warning'
        ? {
            background: 'oklch(0.7 0.14 75 / 0.1)',
            border: '1px solid oklch(0.7 0.14 75 / 0.35)',
            color: 'var(--warn)',
          }
        : {
            background: 'oklch(0.62 0.16 145 / 0.1)',
            border: '1px solid oklch(0.62 0.16 145 / 0.35)',
            color: 'oklch(0.62 0.16 145)',
          }
  return (
    <div className="ts-12 mono mt-2 rounded px-3 py-2" style={style}>
      {children}
    </div>
  )
}

function Th({ children, width }: { children?: ReactNode; width?: number }) {
  return (
    <th
      className="ts-11 mono px-3 py-3 text-left"
      style={{
        width,
        color: 'var(--mute)',
        fontWeight: 500,
        borderBottom: '1px solid var(--line)',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td
      className="px-3 py-3 align-top"
      style={{ borderBottom: '1px solid var(--line)' }}
    >
      {children}
    </td>
  )
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded px-3 py-2"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <div className="ts-13 mt-1" style={{ color: 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

function WorkflowBadge({ status }: { status: string }) {
  const tone = workflowTone(status)
  const Icon =
    status === 'approved'
      ? CheckCircle2
      : status === 'submitted' ||
          status === 'ai_review' ||
          status === 'reviewing'
        ? ShieldCheck
        : status === 'revising' || status === 'rejected'
          ? Flag
          : Users
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        color: tone.fg,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <Icon size={13} />
      {formatWorkflowStatus(status)}
    </span>
  )
}

function isBatchEditable(topic: TopicRow) {
  return topic.status === 'drafting' && !topic.assignedTo
}

function formatTopicPreview(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Untitled item'
  const data = value as Record<string, unknown>
  for (const key of ['prompt', 'question', 'title', 'text', 'input']) {
    if (typeof data[key] === 'string' && data[key].trim()) {
      return truncate(data[key], 120)
    }
  }
  const json = JSON.stringify(data)
  return truncate(json ?? 'Untitled item', 120)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return '[unserializable]'
  }
}

function formatWorkflowStatus(status: string): string {
  if (status === 'drafting') return 'Drafting'
  if (status === 'revising') return 'Revising'
  if (status === 'submitted') return 'Submitted'
  if (status === 'ai_review') return 'AI review'
  if (status === 'reviewing') return 'Reviewing'
  if (status === 'awaiting_acceptance') return 'Awaiting acceptance'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return status
}

function workflowTone(status: string) {
  if (status === 'approved') {
    return {
      fg: 'oklch(0.62 0.16 145)',
      bg: 'oklch(0.62 0.16 145 / 0.1)',
      border: 'oklch(0.62 0.16 145 / 0.35)',
    }
  }
  if (status === 'submitted' || status === 'ai_review' || status === 'reviewing') {
    return {
      fg: 'var(--warn)',
      bg: 'oklch(0.76 0.14 80 / 0.1)',
      border: 'oklch(0.76 0.14 80 / 0.35)',
    }
  }
  if (status === 'rejected' || status === 'revising') {
    return {
      fg: 'var(--danger)',
      bg: 'var(--danger-soft)',
      border: 'oklch(0.55 0.2 25 / 0.35)',
    }
  }
  return {
    fg: 'var(--accent)',
    bg: 'var(--accent-soft)',
    border: 'var(--accent-line)',
  }
}

function formatDate(value: Date | string | null): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toISOString().slice(0, 10)
}

const ghostButtonStyle = {
  minHeight: 40,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  cursor: 'pointer',
} as const

const iconButtonStyle = {
  width: 36,
  height: 36,
  background: 'transparent',
  color: 'var(--mute)',
  border: '1px solid var(--line)',
  cursor: 'pointer',
} as const
