import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { EmptyState } from '@/components/ui'
import { PortfolioManager, type PortfolioRow } from './PortfolioManager'

export const metadata = { title: 'Portfolio' }

export default async function PortfolioPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data: prov } = await supabase
    .from('providers').select('id').eq('user_id', user.id).maybeSingle()
  const provider = prov as { id: string } | null

  if (!provider) {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">Portfolio</h1>
        <EmptyState title="This is for stylist accounts">
          A portfolio is where stylists show their work. Your account is set up as a model.
        </EmptyState>
      </>
    )
  }

  const { data } = await supabase
    .from('portfolio_items')
    .select('id, media_url, media_type, moderation_status')
    .eq('provider_id', provider.id)
    .order('created_at', { ascending: false })

  const items: PortfolioRow[] = ((data ?? []) as {
    id: string; media_url: string; media_type: string | null; moderation_status: string | null
  }[]).map(i => ({
    id: i.id, mediaUrl: i.media_url, mediaType: i.media_type, moderationStatus: i.moderation_status,
  }))

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl text-warm-dark">Portfolio</h1>
        <Link href={`/stylist/${provider.id}`} className="text-sm font-bold text-rose hover:underline">
          View your profile →
        </Link>
      </div>
      <PortfolioManager providerId={provider.id} userId={user.id} initial={items} />
    </>
  )
}
