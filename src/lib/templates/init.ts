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
import './modes/classic-survey'
import './modes/pair-annotation'
import './modes/arena-battle'
import './modes/token-economy'
import './modes/game-mode'
import './modes/apprentice-mode'
import './modes/agent-trace-eval' // flagship

export {}
