export function getPublicOrigin(request: Request): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.PUBLIC_BASE_URL
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Fall through to forwarded headers.
    }
  }

  const requestUrl = new URL(request.url)
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const forwardedProto = firstHeaderValue(
    request.headers.get('x-forwarded-proto'),
  )
  const host = forwardedHost ?? request.headers.get('host') ?? requestUrl.host
  const proto = forwardedProto ?? requestUrl.protocol.replace(/:$/, '') ?? 'https'
  return `${proto}://${host}`
}

export function publicUrl(path: string, request: Request): URL {
  return new URL(path, getPublicOrigin(request))
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}
