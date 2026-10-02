/**
 * ⚠️ HERE, NOT IN actions.ts. A 'use server' file may export ASYNC FUNCTIONS
 * AND NOTHING ELSE — `export const FLOOR_MAX = 280` beside the actions is a
 * build error, and the page served nothing at all until this moved.
 *
 * Worth knowing how it was found: tsc passed, eslint passed, and the whole
 * `npm run checks` chain passed, because this is a Next.js rule rather than a
 * TypeScript one. It took loading the page in the browser. Same family as the
 * JSX comment that 404'd the apply route (item 132) — a build that compiles is
 * not a page that renders.
 */
export const FLOOR_MAX = 280
