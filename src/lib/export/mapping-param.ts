import { AppError } from '@/lib/errors'
import type { FieldMapping } from './formatters'

export function parseFieldMappingParam(
  raw: string | null,
): FieldMapping[] | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError(
      'VALIDATION_ERROR',
      'mapping must be a JSON array.',
      400,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'mapping must be a JSON array.',
      400,
    )
  }
  if (parsed.length > 50) {
    throw new AppError(
      'VALIDATION_ERROR',
      'mapping can contain at most 50 fields.',
      400,
    )
  }

  return parsed.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `mapping[${idx}] must be an object.`,
        400,
      )
    }
    const row = entry as Record<string, unknown>
    if (
      typeof row.source !== 'string' ||
      !row.source.trim() ||
      typeof row.target !== 'string' ||
      !row.target.trim()
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `mapping[${idx}] requires non-empty source and target strings.`,
        400,
      )
    }
    if (
      row.transform !== undefined &&
      row.transform !== 'identity' &&
      row.transform !== 'json_stringify'
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `mapping[${idx}].transform must be identity or json_stringify.`,
        400,
      )
    }
    return {
      source: row.source.trim(),
      target: row.target.trim(),
      transform: row.transform as FieldMapping['transform'],
    }
  })
}
