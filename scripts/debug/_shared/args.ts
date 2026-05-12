/**
 * Lightweight argv parser shared by all scripts/debug/* CLI shims.
 *
 * Supports `--flag value`, `--flag=value`, and bare `--bool` toggles. Anything
 * that isn't a known flag becomes a positional in `_`. We deliberately avoid
 * pulling in a dependency (yargs, commander, etc.) — every script needs ≤5
 * flags and we'd rather not bloat the install.
 */
export type ArgValue = string | number | boolean | string[] | undefined
export type ParsedArgs = Record<string, ArgValue>

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const out: ParsedArgs = { _: positional }
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=')
      if (eq > -1) {
        out[tok.slice(2, eq)] = tok.slice(eq + 1)
      } else {
        const key = tok.slice(2)
        const next = argv[i + 1]
        if (next != null && !next.startsWith('--')) {
          out[key] = next
          i++
        } else {
          out[key] = true
        }
      }
    } else {
      positional.push(tok)
    }
  }
  return out
}

/** Convenience: get the `_` positional list with a stable type. */
export function positionals(args: ParsedArgs): string[] {
  return Array.isArray(args._) ? args._ : []
}

/** True when this module was invoked as the entry point (works on Windows under tsx). */
export function isMain(importMetaUrl: string): boolean {
  if (!process.argv[1]) return false
  const argv1 = process.argv[1].replace(/\\/g, '/')
  // Normalize both sides: strip the file:// + leading slash on Windows so the
  // compare survives `tsx scripts\debug\foo.ts` vs the ESM-style file URL.
  const meta = importMetaUrl.replace(/^file:\/\//, '').replace(/^\/(?=[A-Za-z]:)/, '')
  return meta.toLowerCase() === argv1.toLowerCase()
}

/** Run an async main fn with consistent error reporting + JSON output. */
export async function cliRun<T>(fn: () => Promise<T>): Promise<void> {
  try {
    const result = await fn()
    if (result !== undefined) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    }
    process.exit(0)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`\n[error] ${msg}\n`)
    if (e instanceof Error && e.stack) {
      process.stderr.write(e.stack + '\n')
    }
    process.exit(1)
  }
}
