import type { Metadata } from 'next'
import { LegalDocument } from '@/components/LegalDocument'
import { COMMUNITY } from '@/content/legal'

export const metadata: Metadata = {
  title: COMMUNITY.metaTitle,
  description: COMMUNITY.metaDescription,
  alternates: { canonical: '/community' },
}

export default function Page() {
  return <LegalDocument doc={COMMUNITY} />
}
