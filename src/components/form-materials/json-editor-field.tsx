'use client'

import { useMemo, useState } from 'react'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import {
  TextRow,
  ToggleRow,
} from './primitives'
import type { Material, RuntimeRendererProps } from './types'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Structured JSON input. The runtime editor does a JSON.parse syntax
 * check and — when a draft-07 `jsonSchema` is configured — validates the
 * parsed value against it with ajv, surfacing each error inline.
 * The canvas preview shows a static code-block stub.
 */
type JsonEditorConfig = {
  jsonSchema?: unknown
  formatOnBlur?: boolean
}

/**
 * A single line the editor surfaces below the textarea. `path` is the
 * ajv `instancePath` (empty string for the document root, or a JSON
 * syntax error) and `message` is the human-readable reason.
 */
type ValidationIssue = { path: string; message: string }

/** Compile a draft-07 validator for `schema`, or null if not validatable.
 *
 * ajv@8's default meta-schema is draft-07, so `new Ajv()` validates
 * draft-07 documents directly. We swallow a malformed schema (e.g. a
 * half-typed schema in the property panel) and fall back to syntax-only
 * validation rather than crashing the Labeler's editor. */
function compileSchema(schema: unknown): ValidateFunction | null {
  if (schema == null || typeof schema !== 'object') return null
  try {
    const ajv = new Ajv({ allErrors: true })
    addFormats(ajv)
    return ajv.compile(schema)
  } catch {
    return null
  }
}

/** Map ajv errors to inline issues (instancePath + message). */
function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors) return []
  return errors.map((e) => ({
    path: e.instancePath || '(root)',
    message: e.message ?? 'is invalid',
  }))
}

function JsonEditorRuntime({
  field,
  value,
  onChange,
  readOnly,
}: RuntimeRendererProps) {
  const cfg = field.config as JsonEditorConfig
  // Compile the validator once per schema, not on every keystroke/blur.
  const validate = useMemo(
    () => compileSchema(cfg.jsonSchema),
    [cfg.jsonSchema],
  )

  const initialText =
    value === undefined || value === null
      ? ''
      : typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value, null, 2)
            } catch {
              return ''
            }
          })()

  // Validate the incoming value so pre-existing errors show on mount.
  const [issues, setIssues] = useState<ValidationIssue[]>(() =>
    checkText(initialText, validate),
  )

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        defaultValue={initialText}
        onBlur={(e) => {
          if (readOnly) return
          const raw = e.target.value
          const trimmed = raw.trim()
          if (!trimmed) {
            setIssues([])
            onChange(null)
            return
          }
          try {
            const parsed = JSON.parse(trimmed)
            if (cfg.formatOnBlur && typeof parsed !== 'string') {
              e.target.value = JSON.stringify(parsed, null, 2)
            }
            // Syntax is valid — run schema validation (if configured).
            if (validate && !validate(parsed)) {
              setIssues(toIssues(validate.errors))
            } else {
              setIssues([])
            }
            onChange(parsed)
          } catch (err) {
            // Keep the string so the Labeler can correct on next blur.
            setIssues([
              {
                path: '(syntax)',
                message: getErrorMessage(err, 'Invalid JSON'),
              },
            ])
            onChange(raw)
          }
        }}
        readOnly={readOnly}
        rows={8}
        spellCheck={false}
        aria-invalid={issues.length > 0}
        className="w-full ts-12 mono resize-y"
        style={{
          background: 'var(--bg)',
          border: `1px solid ${
            issues.length > 0 ? 'var(--danger)' : 'var(--line)'
          }`,
          borderRadius: 4,
          padding: '8px 10px',
          color: 'var(--text)',
        }}
      />
      {issues.length > 0 ? (
        <ul
          className="ts-11 mono flex flex-col gap-0.5"
          style={{ color: 'var(--danger)', margin: 0, paddingLeft: 0, listStyle: 'none' }}
        >
          {issues.map((issue, i) => (
            <li key={`${issue.path}_${i}`}>
              <span style={{ opacity: 0.8 }}>{issue.path}</span>{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Parse + (optionally) schema-check a text blob, returning inline issues.
 *  An empty document and a value that fails JSON.parse mirror the blur
 *  handler's behavior so the mount-time and blur-time checks agree. */
function checkText(
  text: string,
  validate: ValidateFunction | null,
): ValidationIssue[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    return [
      {
        path: '(syntax)',
        message: getErrorMessage(err, 'Invalid JSON'),
      },
    ]
  }
  if (validate && !validate(parsed)) return toIssues(validate.errors)
  return []
}

export const jsonEditorFieldMaterial: Material = {
  kind: 'json-editor',
  name: 'JSON',
  icon: '{ }',
  defaultConfig: {
    /** Optional JSON Schema (draft-07) to validate input. */
    jsonSchema: null,
    /** Pretty-print on blur. */
    formatOnBlur: true,
  } satisfies JsonEditorConfig,
  designerPreview: () => (
    <pre
      className="ts-12 mono rounded"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        color: 'var(--mute)',
        padding: '8px 12px',
        margin: 0,
        cursor: 'grab',
        overflow: 'hidden',
      }}
    >
      {'{\n  "key": "value",\n  ...\n}'}
    </pre>
  ),
  runtimeRenderer: JsonEditorRuntime,
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as JsonEditorConfig
    function patch(next: Partial<JsonEditorConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }

    const schemaText =
      cfg.jsonSchema == null
        ? ''
        : (() => {
            try {
              return JSON.stringify(cfg.jsonSchema, null, 2)
            } catch {
              return ''
            }
          })()

    return (
      <>
        <ToggleRow
          label="Format on blur"
          hint="Pretty-print the editor contents when focus leaves the field."
          value={cfg.formatOnBlur ?? true}
          onChange={(v) => patch({ formatOnBlur: v })}
        />
        <TextRow
          label="JSON Schema"
          hint="Optional draft-07 schema. Empty = freeform JSON."
          value={schemaText}
          onChange={(raw) => {
            const trimmed = raw.trim()
            if (!trimmed) {
              patch({ jsonSchema: null })
              return
            }
            try {
              patch({ jsonSchema: JSON.parse(trimmed) })
            } catch {
              // Ignore — Renderer revalidates; the owner sees the bad
              // JSON in the textarea and corrects on next blur.
            }
          }}
          placeholder='{ "type": "object", ... }'
          multiline
        />
      </>
    )
  },
}
