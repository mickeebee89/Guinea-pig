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

  /**
   * ── no-img-element IS OFF FOR THE OG IMAGE ROUTES, IN CONFIG NOT INLINE ──
   *
   * `app/opengraph-image.tsx` renders through next/og (Satori), which is not
   * the browser and cannot use next/image. A plain <img> is the only option
   * there, so the rule is wrong about these files and suppressing it is right.
   *
   * IT WAS AN INLINE eslint-disable-next-line AND THAT BROKE CI (8 Sep 2026).
   * The rule fires on Windows/Node 24 and did not fire on the Linux runner, so
   * the directive was "used" locally and "unused" there — and an unused
   * directive is a warning, which `--max-warnings=0` turns into a failure. The
   * check passed on every machine it had ever been run on and failed the first
   * time it ran anywhere else.
   *
   * WHY THE RULE BEHAVES DIFFERENTLY ACROSS THOSE TWO ENVIRONMENTS IS NOT
   * KNOWN. It was not reproduced here — a fresh clone on this machine still
   * fires the rule — and no Linux runner is available to bisect it. This fix
   * does not depend on the answer: a config-level rule override is never
   * reported as an unused directive, so the outcome is the same either way.
   * The open question is recorded rather than dressed up as a diagnosis.
   */
  {
    files: ['app/**/opengraph-image.tsx', 'app/**/twitter-image.tsx'],
    rules: { '@next/next/no-img-element': 'off' },
  },
])

export default eslintConfig
