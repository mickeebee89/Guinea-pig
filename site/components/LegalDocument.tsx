import type { LegalBlock, LegalDoc } from '@/content/legal'
import { SUPPORT_EMAIL } from '@/lib/site'

/**
 * Turns the support address into a mailto link wherever it appears in the prose,
 * without touching the surrounding wording. Splitting on the literal string is
 * deliberate — a general autolinker would be one more thing that could quietly
 * alter legal text.
 */
function linkifyEmail(text: string) {
  const parts = text.split(SUPPORT_EMAIL)
  if (parts.length === 1) return text
  return parts.flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <a
            key={i}
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-rose underline decoration-rose/30 underline-offset-2 hover:decoration-rose"
          >
            {SUPPORT_EMAIL}
          </a>,
          part,
        ],
  )
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === 'ul') {
    return (
      <ul className="mt-3 space-y-2">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-warm-dark/80">
            <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-rose/50" />
            <span>{linkifyEmail(item)}</span>
          </li>
        ))}
      </ul>
    )
  }
  return <p className="mt-3 text-warm-dark/80">{linkifyEmail(block.text)}</p>
}

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const numbered = doc.sections.some((s) => s.n)

  return (
    <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <header className="border-b border-hairline pb-8">
        <p className="font-sans text-xs font-bold uppercase tracking-[0.18em] text-rose">Legal</p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-warm-dark sm:text-5xl">
          {doc.title}
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: {doc.updated}</p>
      </header>

      {doc.intro && (
        <p className="mt-8 text-lg leading-relaxed text-warm-dark/80">{doc.intro}</p>
      )}

      <div className="mt-4">
        {doc.sections.map((section, i) => {
          // Clause numbers are anchors, not decoration: the app's refund copy
          // links straight to Terms section 9, so these ids are load-bearing.
          const id = section.n ?? slugifyHeading(section.heading)
          return (
            <section
              key={id}
              id={id}
              className="scroll-mt-24 border-b border-hairline py-8 last:border-b-0"
            >
              <div className={numbered ? 'sm:grid sm:grid-cols-[3.5rem_1fr] sm:gap-x-4' : ''}>
                {section.n && (
                  <a
                    href={`#${id}`}
                    aria-label={`Link to section ${section.n}: ${section.heading}`}
                    // Negative margin buys a 44px tap target without adding a
                    // gap above every clause on a phone. These are standalone
                    // controls, not links inside a sentence, so the size rule
                    // applies to them.
                    className="-my-2 flex min-h-11 items-center font-display text-2xl leading-none text-rose/40 transition-colors hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose sm:my-0 sm:justify-end sm:pt-1"
                  >
                    {section.n}
                  </a>
                )}
                <div>
                  <h2 className="font-display text-xl text-warm-dark sm:text-2xl">
                    {section.heading}
                  </h2>
                  {section.blocks.map((block, j) => (
                    <Block key={j} block={block} />
                  ))}
                </div>
              </div>
              {i === doc.sections.length - 1 && <span className="sr-only">End of document.</span>}
            </section>
          )
        })}
      </div>
    </article>
  )
}

function slugifyHeading(h: string) {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
