/**
 * Template registration — side-effect imports.
 *
 * Import this once at app boot (Server Component, Server Action, etc.) to ensure
 * every template registers itself with the global registry before any workspace
 * creation flow tries to look one up.
 *
 * Adding a new mode: write `./modes/<name>.ts` that calls `registerTemplate`,
 * then add a `import './modes/<name>'` line below.
 */
import './modes/pair-rubric'
import './modes/arena-gsb'
import './modes/agent-trace-eval' // flagship
import './modes/custom-designer' // finals P1 — PM-defined schema
import './modes/rubric-judgment' // rubric-authoring + judgement meta-review

export {}
