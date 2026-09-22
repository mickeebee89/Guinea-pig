import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getShopEditorData, getStylistSetup, publishRefusal } from '@/lib/queries/shop'
import { StylistSetupPanel } from '@/components/StylistSetup'
import { EmptyState, LoadError } from '@/components/ui'
import { ShopDetailsForm } from './ShopDetailsForm'
import { TreatmentPicker } from './TreatmentPicker'
import { ShopVisibility } from './ShopVisibility'

export const metadata = { title: 'Your shop' }

/**
 * Shop details and treatments, in one place.
 *
 * Two forms rather than one, each saving independently — see TreatmentPicker
 * for why. They share a page because "edit my shop" is one errand: splitting it
 * across two routes would mean two navigations to finish setting up, and the
 * setup panel would have to point at both.
 *
 * The publish / hide control sits here too, straight under the setup panel:
 * whether models can see the shop is part of managing it, and this is the page
 * the setup panel and the dashboard both send a stylist to for their shop.
 * It is shown once the shop has been live, or can be published now. A shop
 * that has never been live and can't be published yet is the setup panel's
 * job, and going live the first time has no switch (see lib/queries/shop.ts).
 */
export default async function ShopPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  let shop, setup
  try {
    ;[shop, setup] = await Promise.all([
      getShopEditorData(supabase, user.id),
      getStylistSetup(supabase, user.id),
    ])
  } catch (e) {
    console.error('[shop] load failed', e)
    return <LoadError what="shop" />
  }

  if (!shop) {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">Your shop</h1>
        <EmptyState title="This is for stylist accounts">
          A shop is what stylists set up so models can find them. Your account is set up as a
          model — <Link href="/browse" className="font-bold text-rose hover:underline">browse stylists</Link>{' '}
          instead.
        </EmptyState>
      </>
    )
  }

  const refusal = publishRefusal(setup)
  const showVisibility = setup.isPublished || setup.everPublished || refusal === null

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Your shop</h1>

      <div className="space-y-6">
        <StylistSetupPanel setup={setup} />
        {showVisibility && (
          <ShopVisibility
            isPublished={setup.isPublished}
            refusal={refusal}
            onPublicSite={setup.isPublished && setup.websiteBlockers.length === 0}
          />
        )}
        <ShopDetailsForm
          initial={{ name: shop.name, bio: shop.bio, locationText: shop.locationText }}
        />
        <TreatmentPicker all={shop.allCategories} initial={shop.selected} />
      </div>
    </>
  )
}
