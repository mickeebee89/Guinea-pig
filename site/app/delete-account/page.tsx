import type { Metadata } from 'next'
import { LegalDocument } from '@/components/LegalDocument'
import { DELETE_ACCOUNT } from '@/content/legal'

export const metadata: Metadata = {
  title: DELETE_ACCOUNT.metaTitle,
  description: DELETE_ACCOUNT.metaDescription,
  alternates: { canonical: '/delete-account' },
}

export default function Page() {
  return <LegalDocument doc={DELETE_ACCOUNT} />
}
