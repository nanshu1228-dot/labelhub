import type { NextConfig } from 'next'

/**
 * Next.js 16 config.
 *
 * `output: 'standalone'` enables a minimal production server bundle for Docker
 * (~150 MB image vs ~1.2 GB without). See Dockerfile for the multi-stage build.
 *
 * Other Next 16 options to consider later:
 *   - cacheComponents: true   (PPR opt-in; needs auditing for our streaming flows)
 *   - reactCompiler: true     (after we have stable build perf benchmarks)
 */
const nextConfig: NextConfig = {
  output: 'standalone',
}

export default nextConfig
