'use client'

import {
  NumberRow,
  TagListRow,
} from '@/components/form-designer/properties/primitives'
import type { Material } from './types'

/**
 * File / image upload. D6 Renderer wires this to Supabase Storage via
 * the existing upload helpers. accept[] follows the input[type=file]
 * accept attribute convention.
 */
type FileUploadConfig = {
  accept?: string[]
  maxSizeMb?: number
  maxFiles?: number
}

export const fileUploadFieldMaterial: Material = {
  kind: 'file-upload',
  name: 'File / image',
  icon: '⬆',
  defaultConfig: {
    accept: ['image/*'],
    maxSizeMb: 5,
    maxFiles: 1,
  } satisfies FileUploadConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as FileUploadConfig
    return (
      <div
        className="rounded p-4 text-center ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px dashed var(--line)',
          color: 'var(--mute)',
          cursor: 'grab',
        }}
      >
        <div className="ts-22 mb-1">⬆</div>
        <div>Drop files or click to upload</div>
        <div
          className="ts-11 mono mt-1"
          style={{ color: 'var(--mute2)' }}
        >
          accept: {(cfg.accept ?? []).join(', ') || 'any'} · max
          {' '}
          {cfg.maxSizeMb ?? 5}MB
          {(cfg.maxFiles ?? 1) > 1 ? ` · up to ${cfg.maxFiles} files` : ''}
        </div>
      </div>
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as FileUploadConfig
    function patch(next: Partial<FileUploadConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <TagListRow
          label="Accept"
          hint="MIME types or extensions (image/*, .pdf, application/json)"
          value={cfg.accept ?? []}
          onChange={(accept) => patch({ accept })}
          placeholder="image/*, .pdf"
        />
        <NumberRow
          label="Max size (MB)"
          value={cfg.maxSizeMb ?? 5}
          onChange={(v) => patch({ maxSizeMb: v ?? 5 })}
          min={1}
        />
        <NumberRow
          label="Max files"
          value={cfg.maxFiles ?? 1}
          onChange={(v) => patch({ maxFiles: v ?? 1 })}
          min={1}
        />
      </>
    )
  },
}
