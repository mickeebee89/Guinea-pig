import type { Metadata } from 'next'
import { LegalDocument } from '@/components/LegalDocument'
import { PRIVACY } from '@/content/legal'

export const metadata: Metadata = {
  title: PRIVACY.metaTitle,
  description: PRIVACY.metaDescription,
  alternates: { canonical: '/privacy' },
}

export default function Page() {
  return <LegalDocument doc={PRIVACY} />
}
