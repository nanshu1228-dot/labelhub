// Empty stub for `server-only` package in Vitest.
// Next.js uses `import 'server-only'` to make modules client-bundler-unsafe.
// In Vitest (running in Node), we replace that import with this no-op so
// pure-function tests can import server-only modules without errors.
//
// Note: tests in server-only files MUST still avoid actually CALLING functions
// that require a runtime (DB, cookies, etc.). Aim for pure-function tests only.
export {}
