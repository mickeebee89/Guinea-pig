/**
 * DEMO MODE — serves the AI-generated seed photos from seed/photos/ to the
 * demo pages. Audit item 69.
 *
 * ⚠️ NOT A ROUTE IN ANY REAL BUILD, for the same reason as app/demo: the
 * `.demo.ts` extension only counts under local `next dev` with DEMO_MODE=1.
 *
 * Read straight from seed/photos/ (gitignored) rather than copied into
 * public/, so the images exist in one place and can never be deployed.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { assertDemoAllowed } from '@/lib/demo/guard'

assertDemoAllowed('the /demo-photos route')

const ROOT = path.resolve(process.cwd(), '..', 'seed', 'photos')
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params
  const file = path.resolve(ROOT, ...parts)
  // Only files inside seed/photos, and only images.
  const type = TYPES[path.extname(file).toLowerCase()]
  if (!file.startsWith(ROOT + path.sep) || !type) return new Response('Not found', { status: 404 })
  try {
    const body = await readFile(file)
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
