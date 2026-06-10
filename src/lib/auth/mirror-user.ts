import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { displayNameFromMetadata } from './user-metadata'

export type AuthUserMirrorInput = {
  id: string
  email: string
  metadata?: Record<string, unknown> | null
}

export type MirroredAuthUser = {
  id: string
  authId: string
  email: string
  displayName: string | null
  usedExistingEmail: boolean
}

export async function mirrorAuthUser(
  input: AuthUserMirrorInput,
): Promise<MirroredAuthUser> {
  const displayName = displayNameFromMetadata(input.metadata)
  const db = getDb()
  try {
    await db
      .insert(users)
      .values({
        id: input.id,
        email: input.email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: input.email,
          ...(displayName === null
            ? {}
            : {
                displayName: sql`coalesce(${users.displayName}, excluded.display_name)`,
              }),
        },
      })
    return {
      id: input.id,
      authId: input.id,
      email: input.email,
      displayName,
      usedExistingEmail: false,
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }

  const [existing] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  if (!existing) {
    throw new Error('User email conflict, but no matching local user was found.')
  }

  if (displayName !== null && existing.displayName === null) {
    await db
      .update(users)
      .set({ displayName })
      .where(eq(users.id, existing.id))
  }

  return {
    id: existing.id,
    authId: input.id,
    email: existing.email,
    displayName: existing.displayName ?? displayName,
    usedExistingEmail: true,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}
