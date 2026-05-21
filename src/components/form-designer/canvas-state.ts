'use client'

/**
 * Designer canvas state — Finals P1 D3.
 *
 * Jotai atom holding the in-progress FormSchema. Persists to
 * localStorage so a tab refresh restores work (the D3 gate). D6
 * swaps the storage backend for Dexie + server-action save against
 * `custom_form_schemas`.
 *
 * `atomWithStorage` from jotai/utils takes a (key, default) pair and
 * mirrors writes to localStorage on the client; SSR sees the default.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  EMPTY_FORM,
  type FieldKind,
  type FieldNode,
  type FormSchema,
} from '@/lib/form-designer/schema'

const STORAGE_KEY = 'lh.designer.draft.v1'

/**
 * Persisted draft form schema. atomWithStorage runs both reads + writes
 * through localStorage; SSR hydration uses EMPTY_FORM (the canvas
 * renders empty for a microsecond before client-side hydrate fills
 * the actual saved state).
 */
export const formSchemaAtom = atomWithStorage<FormSchema>(
  STORAGE_KEY,
  EMPTY_FORM,
)

/** Currently-selected field ID (drives the property panel). */
export const selectedFieldIdAtom = atom<string | null>(null)

/**
 * Generate a short, sortable ID for a new field. Crypto-random the
 * suffix so two fields added in the same millisecond don't collide.
 */
export function newFieldId(): string {
  const ts = Date.now().toString(36)
  // 4 random bytes → 8 hex chars
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Math.floor(Math.random() * 0xffffffff)
          .toString(16)
          .padStart(8, '0')
  return `f_${ts}_${rand}`
}

/**
 * Build a FieldNode from a palette drop. Material's defaultConfig is
 * cloned (deep) so two drops of the same material don't share config
 * references and confuse the canvas state.
 */
export function makeFieldFromKind(
  kind: FieldKind,
  defaultConfig: Record<string, unknown>,
  defaultLabel: string,
): FieldNode {
  return {
    id: newFieldId(),
    kind,
    label: defaultLabel,
    config: structuredClone(defaultConfig),
    validation: [],
  }
}
