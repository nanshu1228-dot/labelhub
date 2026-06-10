export function oauthCallbackUrlFromEntrypoint(requestUrl: string): string | null {
  const url = new URL(requestUrl)
  if (url.pathname !== '/') return null

  const callbackPath = oauthCallbackPathFromEntries(url.searchParams.entries())
  if (!callbackPath) return null

  const callbackUrl = new URL(callbackPath, url.origin)
  return callbackUrl.toString()
}

export type OAuthEntrypointSearchParams = Record<
  string,
  string | string[] | undefined
>

export function oauthCallbackPathFromSearchParams(
  searchParams: OAuthEntrypointSearchParams,
): string | null {
  const entries: Array<[string, string]> = []
  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === 'string') {
      entries.push([key, value])
      return
    }
    value?.forEach((item) => entries.push([key, item]))
  })

  return oauthCallbackPathFromEntries(entries)
}

function oauthCallbackPathFromEntries(
  entries: Iterable<[string, string]>,
): string | null {
  const query = new URLSearchParams()
  let hasOAuthResult = false

  for (const [key, value] of entries) {
    if (isOAuthResultParam(key)) hasOAuthResult = true
    query.append(key, value)
  }

  if (!hasOAuthResult) return null
  const queryString = query.toString()
  return queryString ? `/auth/callback?${queryString}` : '/auth/callback'
}

function isOAuthResultParam(key: string): boolean {
  return key === 'code' || key === 'error' || key === 'error_description'
}
