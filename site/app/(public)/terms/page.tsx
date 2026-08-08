import type { Metadata } from 'next'
import { LegalDocument } from '@/components/LegalDocument'
import { TERMS } from '@/content/legal'

export const metadata: Metadata = {
  title: TERMS.metaTitle,
  description: TERMS.metaDescription,
  alternates: { canonical: '/terms' },
}

export default function Page() {
  return <LegalDocument doc={TERMS} />
}
