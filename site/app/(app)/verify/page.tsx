import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getStylistSetup } from '@/lib/queries/shop'
import { getIdCheck } from '@/lib/queries/idCheck'
import { IdCheckStep } from '@/components/IdCheckStep'

export const metadata = { title: 'ID check' }

/**
 * The ID check. One page, both roles, any time after signup.
 *
 * ── DESCRIBED MODESTLY, AND THAT IS A RULE ────────────────────────────────
 * A person compares a selfie holding a handwritten note against the profile
 * photo. It shows a real person made the effort and that the photo is not
 * lifted from somewhere else. It is NOT identity verification — no document is
 * requested, seen or kept.
 *
 * A model weighs this when deciding whether to be alone with a stranger.
 * Someone who believes a passport was checked accepts a risk they would not
 * otherwise accept, on the strength of our wording. Say less than is true.
 *
 * ── ⚠️ MODELS ARE WELCOME HERE NOW. CHANGED 6 Nov 2026. ───────────────────
 * This page said: "There is no standalone model entry point here and there
 * must not be one." The reason was that the app's old "Get verified" buttons
 * produced accounts that were verified but not subscribed — people who had
 * done the work and still could not apply, because membership was the first
 * gate and the ID check came after it inside the apply flow.
 *
 * That was a real problem when it was written. It is not the problem now. The
 * order is reversed: the ID check is available from signup, and the £4.99
 * membership is the LAST gate before applying. A verified-but-unsubscribed
 * account is no longer a stranded account — it is the warmest lead on the
 * platform, and the only thing left between her and a booking is the one
 * decision we want her making last.
 *
 * ⚠️ THIS REMOVES AN OBSTACLE BEFORE ANYONE REACHES IT. IT DOES NOT RECOVER
 * LOST CONVERSIONS AND MUST NOT BE DESCRIBED AS DOING SO. Thirty days to
 * 6 Nov 2026: 1,180 homepage visitors, 279 reached /sign-up, 107 reached a
 * dashboard, 43 browsed, 32 opened a stylist, 1 reached the apply flow — with
 * 7 pageviews against that 1 visitor, which is testing. /subscribe has had 2
 * visitors ever. All 55 real model accounts are unverified and unsubscribed
 * because none of them has been asked, not because any refused: the membership
 * wall has been rendered to almost nobody, and one real bookable slot has ever
 * existed before 5 Nov 2026 (posted 24 Oct for 28 Oct, passed unbooked). The
 * gain is that a new model has something to do on day one.
 *
 * The server half moved with it: submitSelfie() no longer requires a model to
 * have an active membership. Every other check it makes is unchanged.
 */

/** Shared chrome for every state of this page. Defined at module scope, not
 *  inside the component: a component created during render is a new type on
 *  every render, so React unmounts and remounts its whole subtree. eslint
 *  caught this one — which it could only do because the config was fixed.
 *
 *  ⚠️ THE BACK LINK IS ROLE-AWARE BECAUSE A MODEL HAS NO SHOP. It read "←
 *  Back to your shop" unconditionally, and only missed her because the
 *  no-provider branch returned without this wrapper. The moment she reached
 *  any other state she was pointed at a page that does not exist for her. */
function Wrap({ children, isStylist }: { children: React.ReactNode; isStylist: boolean }) {
  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">ID check</h1>
      <section>{children}</section>
      <p className="mt-4 text-sm">
        <Link
          href={isStylist ? '/shop' : '/profile'}
          className="font-bold text-rose hover:underline"
        >
          {isStylist ? '← Back to your shop' : '← Back to your profile'}
        </Link>
      </p>
    </>
  )
}

export default async function VerifyPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const setup = await getStylistSetup(supabase, user.id)

  // ══ A MODEL. ════════════════════════════════════════════════════════════
  //
  // ⚠️ getIdCheck, NOT setup.idCheck. getStylistSetup returns its EMPTY_SETUP
  // for anyone with no provider row, and that carries `idCheck: 'none'` —
  // which is not a reading of her state, it is the absence of one. A model
  // with a request already pending would be shown the capture screen again,
  // and submitting would delete the request she is waiting on.
  //
  // queries/idCheck.ts exists for exactly this: one derivation, two queries,
  // because a stylist's page already has the row in hand and a model's does
  // not.
  if (!setup.providerId) {
    const [check, { data: userRow }] = await Promise.all([
      getIdCheck(supabase, user.id),
      supabase.from('users').select('profile_pic_url').eq('id', user.id).maybeSingle(),
    ])
    const hasProfilePic = !!(userRow as { profile_pic_url?: string | null } | null)?.profile_pic_url

    return (
      <Wrap isStylist={false}>
        <IdCheckStep
          check={check}
          hasProfilePic={hasProfilePic}
          surface="page"
          photoHref="/profile"
        />
      </Wrap>
    )
  }

  // ══ A STYLIST. ══════════════════════════════════════════════════════════
  //
  // ⚠️⚠️ THE FEE GATE USED TO BE HERE AND IS GONE FROM THE FLOW (0102).
  // Cavy is free for stylists: a stylist now goes straight from here to the ID
  // check with nothing to pay and no mention of a price.
  //
  // ⚠️ GONE FROM THE FLOW, NOT GONE. `FeePanel.tsx` is still in this folder,
  // `setup.feeSettled` is still computed, the server-side gate in actions.ts is
  // still there, and Stripe's two paths are untouched. Putting the fee back is
  // one settings row plus restoring this block — supabase/FEE-REINSTATEMENT.md
  // has the exact text and every other site that has to move with it.
  //
  // ── THE BODY IS IdCheckStep's NOW, FOR BOTH ROLES. 6 Nov 2026. ──────────
  // This page carried its own copy of the four states — the same screen the
  // apply flow renders, written out twice with nothing showing the two side by
  // side. The four numbered steps are what a reviewer is actually looking for,
  // so a member told to write something different from the other version gets
  // rejected for following our own instructions, and the rejection note is the
  // only thing that would ever tell her why. The role differences that were
  // real (which photo, which page to set it on) are props.
  return (
    <Wrap isStylist>
      <IdCheckStep
        check={{ state: setup.idCheck, note: setup.idCheckNote }}
        hasProfilePic={!!setup.profilePicUrl}
        surface="page"
        photoHref="/shop"
      />
    </Wrap>
  )
}
