/**
 * Stub the `server-only` package so CLI scripts can require files that
 * normally mark themselves as React Server Components. The package's
 * production behavior is to throw on import — we replace it with a
 * no-op for the duration of this Node process.
 *
 * Loaded via `node --import` (see backfill scripts in package.json).
 * Must come BEFORE any project-source import.
 */
import { register } from 'node:module'

register(
  // Inline loader source — resolves any `server-only` request to a
  // virtual empty module.
   
  new URL(
    'data:text/javascript,' +
      encodeURIComponent(`
        export async function resolve(specifier, context, next) {
          if (specifier === 'server-only') {
            return { url: 'data:text/javascript,export default {}', shortCircuit: true, format: 'module' }
          }
          return next(specifier, context)
        }
      `),
  ),
  import.meta.url,
)
