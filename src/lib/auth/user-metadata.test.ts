import { describe, expect, it } from 'vitest'
import { displayNameFromMetadata } from './user-metadata'

describe('displayNameFromMetadata', () => {
  it('accepts password-signup display_name and Google full_name/name fields', () => {
    expect(displayNameFromMetadata({ display_name: 'Sasha' })).toBe('Sasha')
    expect(displayNameFromMetadata({ full_name: 'Google User' })).toBe(
      'Google User',
    )
    expect(displayNameFromMetadata({ name: 'Fallback Name' })).toBe(
      'Fallback Name',
    )
  })

  it('returns null for empty or non-string metadata', () => {
    expect(displayNameFromMetadata({ full_name: '   ' })).toBeNull()
    expect(displayNameFromMetadata({ full_name: 42 })).toBeNull()
    expect(displayNameFromMetadata(null)).toBeNull()
  })
})
