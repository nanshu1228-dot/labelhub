export function getOAuthRedirectOrigin(
  currentOrigin: string,
  configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL,
): string {
  const configuredOrigin = parseOrigin(configuredAppUrl)
  if (configuredOrigin) return configuredOrigin

  return parseOrigin(currentOrigin) ?? currentOrigin
}

export function buildOAuthRedirectTo(
  currentOrigin: string,
  next: string,
  configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL,
): string {
  const url = new URL(
    '/auth/callback',
    getOAuthRedirectOrigin(currentOrigin, configuredAppUrl),
  )
  url.searchParams.set('next', next)
  return url.toString()
}

function parseOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}
