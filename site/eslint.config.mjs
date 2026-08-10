import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

/**
 * ── WHY THIS IS NOT THE FlatCompat VERSION ────────────────────────────────
 *
 * This file used to be the shape `create-next-app` emitted years ago:
 *
 *   const compat = new FlatCompat({ baseDirectory: __dirname })
 *   export default [...compat.extends('next/core-web-vitals', 'next/typescript')]
 *
 * FlatCompat routes those names through @eslint/eslintrc, the legacy
 * eslintrc-format loader. eslint-config-next 16 ships NATIVE flat configs whose
 * objects hold their own plugins, so the graph is circular by design
 * (config -> plugins.react -> configs.flat -> plugins.react). The legacy
 * validator rejects that, then tries to format the rejection with
 * JSON.stringify, and dies on the circular structure instead:
 *
 *   TypeError: Converting circular structure to JSON
 *     at ConfigValidator.formatErrors (@eslint/eslintrc/.../config-validator.js:308)
 *
 * That is the crash reporting a crash. `npx eslint <anything>` failed the same
 * way on every file, including files with nothing wrong with them, so linting
 * this app has produced no output at all for an unknown period — and a check
 * that reports nothing looks exactly like a check that finds nothing.
 *
 * admin/eslint.config.mjs was already in this modern shape and works fine. The
 * two now match. Import the flat configs directly and there is no legacy
 * validator in the path to fail.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
])

export default eslintConfig
