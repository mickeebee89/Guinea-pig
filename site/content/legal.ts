/**
 * Legal documents — the canonical copy.
 *
 * PROVENANCE: transcribed 2026-08-07 from the live pages at
 * guineapigapp.co.uk/{terms,privacy,community,delete-account}, which until now
 * were the only copy anywhere and were not in version control.
 *
 * THREE EDITS WERE MADE. Nothing else was changed.
 *
 * 1. TRADING-NAME REBRAND: the service name "Guinea Pig" became "Cavy", and
 *    each document's opening clause now carries the form required by CLAUDE.md
 *    — "Cavy is a trading name of Guinea Pig App Ltd, registered in England &
 *    Wales, company no. 17272796."
 *
 * The legal entity, the company number, the registered address, the support
 * address, every clause number, and all substance are UNCHANGED. The CSAE
 * wording (Terms 12, Community "Child safety standards") is untouched beyond
 * the service name — it is a Play Console child-safety requirement and must
 * stay publicly accessible.
 *
 * 2. FACTUAL CORRECTION: Privacy 9 (Cookies) previously said the site loads
 *    Google Fonts, which may receive your IP address. This site self-hosts its
 *    fonts via next/font, so that statement would be untrue here. Corrected,
 *    and the correction is more privacy-protective, not less.
 *
 * 3. DRAFTING PLACEHOLDERS REMOVED from delete-account — see the note above
 *    that document. The open questions they represented are on the blocker
 *    list; deleting the placeholder did not delete the question.
 *
 * No "last updated" date was changed, and no provenance note is published to
 * users — an internal audit trail belongs here, in the source, not on the page.
 *
 * KNOWN GAP, NOT FIXED HERE: this privacy notice covers the WAITLIST ONLY and
 * says so. It does not cover the app — identity selfies, messages, photos,
 * location and payment records are all absent — yet the shipped app links to it
 * as its privacy policy. Tracked as a pre-launch blocker.
 */

export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }

export interface LegalSection {
  /** Clause number. Terms 9 is linked from the app's refund copy — anchors are load-bearing. */
  n?: string
  heading: string
  blocks: LegalBlock[]
}

export interface LegalDoc {
  slug: string
  title: string
  /** Shown in the browser tab and as the page's meta title. */
  metaTitle: string
  metaDescription: string
  updated: string
  intro?: string
  sections: LegalSection[]
}

const TRADING_NAME =
  'Cavy is a trading name of Guinea Pig App Ltd, registered in England & Wales, company no. 17272796, registered address 75 Aintree Road, Chatham, Kent, ME5 8PQ.'

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  metaTitle: 'Terms of Service',
  metaDescription:
    'The terms that govern your use of the Cavy website, waitlist and mobile app.',
  updated: '12 July 2026',
  sections: [
    {
      n: '1',
      heading: 'Who we are',
      blocks: [
        {
          type: 'p',
          text: `${TRADING_NAME} In these terms, “we”, “us”, “our” and “Cavy” mean Guinea Pig App Ltd. You can contact us at support@guineapigapp.co.uk.`,
        },
      ],
    },
    {
      n: '2',
      heading: 'About these terms',
      blocks: [
        {
          type: 'p',
          text: 'These terms govern your use of the Cavy website, the Cavy waitlist, and the Cavy mobile app (“the app”). By joining the waitlist or using the app, you agree to these terms. If you don’t agree, please don’t use our services. Please also read our Privacy Policy and Community Guidelines, which form part of these terms.',
        },
      ],
    },
    {
      n: '3',
      heading: 'Eligibility',
      blocks: [
        {
          type: 'p',
          text: 'Cavy is strictly for adults. You must be 18 or over to join the waitlist or use the app. By using our services you confirm that you are 18 or over and that the information you give us is accurate.',
        },
      ],
    },
    {
      n: '4',
      heading: 'What Cavy is',
      blocks: [
        {
          type: 'p',
          text: 'Cavy is a marketplace that connects beauty and hair stylists with “models” — members who receive treatments, often at reduced cost or free, so that stylists can practise their skills and build their portfolios. Members arrange treatments with each other and carry them out in person. Cavy provides the platform that helps members find each other; it does not itself provide beauty treatments (see section 10).',
        },
      ],
    },
    {
      n: '5',
      heading: 'The waitlist',
      blocks: [
        {
          type: 'p',
          text: 'Joining the waitlist means we’ll email you when Cavy launches. It doesn’t create an account or guarantee you a place in the app — it simply means you’re on the list to hear from us. We handle your details as described in our Privacy Policy, and you can leave the waitlist at any time by unsubscribing or emailing us.',
        },
        {
          type: 'p',
          text: 'The free early-stylist account offer is for people who join the waitlist as a stylist before launch. Full details will be confirmed at launch, and the offer may be subject to reasonable conditions (for example, completing identity verification) and to availability.',
        },
      ],
    },
    {
      n: '6',
      heading: 'Your account',
      blocks: [
        {
          type: 'p',
          text: 'To use the app you’ll create an account. You agree to give accurate information, keep it up to date, keep your login details secure, and not share your account with anyone else. You’re responsible for activity that happens under your account. You must not create an account if you’ve previously been removed from Cavy, or impersonate anyone else.',
        },
        {
          type: 'p',
          text: 'You can close your account at any time from within the app or by contacting us. We may suspend or close an account if these terms or our Community Guidelines are broken, if we’re required to by law, or where necessary to protect members or the platform.',
        },
      ],
    },
    {
      n: '7',
      heading: 'Identity verification',
      blocks: [
        {
          type: 'p',
          text: 'To help keep the community safe, members complete an identity-verification step, which involves submitting a photograph of themselves. Stylists must complete verification before they can offer treatments. Verification helps confirm that members are real, individual adults; it is not a guarantee of any member’s identity, character, qualifications, or conduct, and you should still use your own judgement when arranging to meet anyone. We handle verification images as described in our Privacy Policy.',
        },
      ],
    },
    {
      n: '8',
      heading: 'Bookings between members',
      blocks: [
        {
          type: 'p',
          text: 'When a model and a stylist agree to a treatment, that arrangement is directly between them. They are responsible for agreeing what the treatment involves, where and when it takes place, and any details such as cost. Cavy is not a party to that arrangement. We ask all members to follow our Community Guidelines, including the safety guidance, when meeting in person.',
        },
        {
          type: 'p',
          text: 'Stylists are responsible for carrying out treatments safely, lawfully and competently, and for holding any insurance, qualifications, or licences that apply to the services they offer. Models are responsible for disclosing any relevant allergies, sensitivities or medical considerations before a treatment.',
        },
      ],
    },
    {
      n: '9',
      heading: 'Payments, subscriptions and refunds',
      blocks: [
        {
          type: 'p',
          text: 'Some features of Cavy require payment — a monthly membership subscription for models, and a one-off identity-verification fee for stylists. Current prices are shown in the app before you pay, and payments are handled by our payment provider (we don’t store your full card details).',
        },
        {
          type: 'p',
          text: 'Model membership subscription. The membership renews automatically each month at the price shown until you cancel. You can cancel at any time from within the app to stop future renewals; when you cancel, your membership continues until the end of the month you’ve already paid for, and you won’t be charged again. We don’t provide partial refunds for the remainder of a month once it has started, except where the law requires otherwise.',
        },
        {
          type: 'p',
          text: 'Stylist verification fee. The verification fee is a one-off charge for processing your identity verification. Because this is a service that begins as soon as you pay, by paying you ask us to start it straight away; once verification has been carried out, the fee is non-refundable except where the law requires otherwise.',
        },
        {
          type: 'p',
          text: 'Your cancellation rights. Where you are a consumer, you may have a legal right to cancel a purchase within 14 days. Because our paid features are digital services that you ask us to provide immediately, this right may end once the service has been provided. Nothing here affects your statutory rights as a consumer. If you think you’re entitled to a refund, or something has gone wrong with a payment, email us at support@guineapigapp.co.uk and we’ll deal with it in line with your rights and these terms.',
        },
      ],
    },
    {
      n: '10',
      heading: 'Our role — and what we’re not responsible for',
      blocks: [
        {
          type: 'p',
          text: 'Cavy is an introduction platform. We help stylists and models find one another, but the treatments themselves are arranged and carried out directly between members, in person. Cavy does not provide beauty treatments, is not a party to the arrangement between a stylist and a model, does not employ or supervise stylists, and does not check the qualifications, insurance, or competence of any member beyond the identity-verification step described above.',
        },
        {
          type: 'p',
          text: 'This means that, as far as the law allows, we are not responsible for the acts, omissions, conduct, or standard of any treatment carried out by members, nor for any arrangement made between members. You use the platform, and meet and deal with other members, at your own risk, and you should always exercise care and good judgement.',
        },
      ],
    },
    {
      n: '11',
      heading: 'Acceptable use',
      blocks: [
        {
          type: 'p',
          text: 'You agree to use Cavy honestly, lawfully and respectfully, and to follow our Community Guidelines. In particular, you must not use Cavy for anything unlawful, fraudulent, abusive, or harmful; must not harass, threaten or endanger other members; must not post false, misleading or offensive content; and must not attempt to disrupt, misuse, or gain unauthorised access to our systems. We may remove content and suspend or remove access where these terms or the guidelines are broken.',
        },
      ],
    },
    {
      n: '12',
      heading: 'Child safety — zero tolerance',
      blocks: [
        {
          type: 'p',
          text: 'Cavy is strictly for adults (18+) and has zero tolerance for child sexual abuse and exploitation (CSAE). Child sexual abuse material (CSAM) and any content or conduct that sexualises, grooms, endangers, exploits, or attempts to arrange contact with a person under 18 is absolutely prohibited. We remove such content and permanently remove the accounts involved, and we report CSAM and related conduct to the relevant authorities in line with UK law. You can report any concern in the app or to our child-safety point of contact at support@guineapigapp.co.uk. Our full child-safety standards are set out in our Community Guidelines.',
        },
      ],
    },
    {
      n: '13',
      heading: 'Content you provide',
      blocks: [
        {
          type: 'p',
          text: 'You keep ownership of the content you add to Cavy, such as your profile and photos. By adding content, you give us permission to host, display and use it as needed to run and promote the service. You’re responsible for the content you provide, and you confirm you have the right to share it and that it doesn’t break the law or anyone else’s rights.',
        },
      ],
    },
    {
      n: '14',
      heading: 'Limitation of liability',
      blocks: [
        {
          type: 'p',
          text: 'Nothing in these terms limits or excludes our liability where it would be unlawful to do so — including for death or personal injury caused by our negligence, or for fraud. Subject to that, and to the fullest extent permitted by law: we provide Cavy “as is” and don’t guarantee it will always be available or error-free; we’re not liable for loss or damage arising from arrangements or treatments between members, or from your dealings with other members; and we’re not liable for any indirect or consequential loss. Where we are found liable to you, our total liability will be limited to the greater of the fees you’ve paid us in the twelve months before the claim, or £100. Your statutory rights as a consumer are not affected.',
        },
      ],
    },
    {
      n: '15',
      heading: 'Changes to the service and these terms',
      blocks: [
        {
          type: 'p',
          text: 'We may change, suspend or withdraw parts of Cavy, and we may update these terms from time to time — for example, to reflect new features or legal requirements. If we make significant changes to these terms, we’ll update the date above and, where appropriate, let you know through the app or by email. Continuing to use Cavy after a change means you accept the updated terms.',
        },
      ],
    },
    {
      n: '16',
      heading: 'Governing law',
      blocks: [
        {
          type: 'p',
          text: 'These terms are governed by the laws of England & Wales, and any disputes will be dealt with by the courts of England & Wales.',
        },
      ],
    },
    {
      n: '17',
      heading: 'Contact',
      blocks: [
        {
          type: 'p',
          text: 'Questions about these terms? Email us any time at support@guineapigapp.co.uk.',
        },
      ],
    },
  ],
}

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  metaTitle: 'Privacy Policy',
  metaDescription:
    'What Cavy does with the details you enter when you join the waitlist, and your rights over them.',
  updated: '11 July 2026',
  sections: [
    {
      n: '1',
      heading: 'Who we are',
      blocks: [
        {
          type: 'p',
          text: `${TRADING_NAME} We are the “data controller” for the information you give us here. You can reach us any time at support@guineapigapp.co.uk.`,
        },
      ],
    },
    {
      n: '2',
      heading: 'What this notice covers',
      blocks: [
        {
          type: 'p',
          text: 'This notice explains what we do with the details you enter when you join our waitlist. It does not yet cover the app, because the app hasn’t launched — that policy is coming.',
        },
      ],
    },
    {
      n: '3',
      heading: 'What we collect',
      blocks: [
        { type: 'p', text: 'When you join the waitlist, we collect only what you enter in the form:' },
        {
          type: 'ul',
          items: [
            'Your first name',
            'Your email address',
            'Whether you’re a stylist or a model',
            'Your city or area, if you choose to add it (optional)',
            'Your TikTok or Instagram handle, if you choose to add it (optional)',
            'A record that you gave consent, and the date you signed up',
          ],
        },
        {
          type: 'p',
          text: 'That’s everything. We don’t collect anything else, and we don’t track you around the web.',
        },
      ],
    },
    {
      n: '4',
      heading: 'Why we use it',
      blocks: [
        {
          type: 'p',
          text: 'We use your details for one purpose: to email you when Cavy launches, and — if you signed up as a stylist — to tell you about the free early-stylist account. We won’t send you anything unrelated.',
        },
      ],
    },
    {
      n: '5',
      heading: 'Our legal basis',
      blocks: [
        {
          type: 'p',
          text: 'We rely on your consent (the box you ticked when you signed up). You can withdraw that consent at any time by unsubscribing or emailing us, and we’ll stop and remove your details.',
        },
      ],
    },
    {
      n: '6',
      heading: 'Who can see it',
      blocks: [
        {
          type: 'p',
          text: 'We do not sell your details, and we do not share them with other companies for their own marketing. To run the waitlist we use a small number of trusted service providers who process your details only on our instructions: our database provider (which stores the list) and our email provider (which sends the launch email). We don’t give your details to anyone else.',
        },
      ],
    },
    {
      n: '7',
      heading: 'How long we keep it',
      blocks: [
        {
          type: 'p',
          text: 'We keep your waitlist details until Cavy launches and we’ve told you about it, or until you unsubscribe or ask us to delete them — whichever comes first. If we decide not to go ahead with the app, we’ll delete the waitlist.',
        },
      ],
    },
    {
      n: '8',
      heading: 'Your rights',
      blocks: [
        { type: 'p', text: 'Under UK data protection law you can, at any time:' },
        {
          type: 'ul',
          items: [
            'Ask what we hold about you, and get a copy',
            'Correct anything that’s wrong',
            'Have your details deleted',
            'Unsubscribe or withdraw your consent',
            'Ask us to send your details to you in a portable format',
          ],
        },
        {
          type: 'p',
          text: 'To do any of these, email support@guineapigapp.co.uk and we’ll sort it out.',
        },
      ],
    },
    {
      n: '9',
      heading: 'Cookies',
      blocks: [
        {
          type: 'p',
          text: 'This website doesn’t use tracking or advertising cookies. Our fonts are served from this site rather than a third party, so loading a page doesn’t share your IP address with anyone else.',
        },
      ],
    },
    {
      n: '10',
      heading: 'Your name in the app (when it launches)',
      blocks: [
        {
          type: 'p',
          text: 'The waitlist above only asks for your first name. When the Cavy app itself launches, signing up will ask for your full name. We collect your surname for account security, identity verification and safety — for example, to keep members accountable and to help us act on reports. Your surname is kept private and is never shown to other users. Publicly, other members only ever see your first name and the first letter of your surname (for example, “Sarah B.”). This paragraph is a heads-up for waitlist members; the full app privacy policy will set this out in detail before launch.',
        },
      ],
    },
    {
      n: '11',
      heading: 'Contact & complaints',
      blocks: [
        {
          type: 'p',
          text: 'Questions or requests: support@guineapigapp.co.uk. If you’re unhappy with how we’ve handled your data, you can complain to the UK’s Information Commissioner’s Office (ICO) at ico.org.uk. We are registered with the ICO under reference ZC196530.',
        },
      ],
    },
  ],
}

export const COMMUNITY: LegalDoc = {
  slug: 'community',
  title: 'Community Guidelines',
  metaTitle: 'Community Guidelines',
  metaDescription:
    'How Cavy keeps things kind, safe and honest — for stylists and models alike.',
  updated: '11 July 2026',
  intro:
    'Cavy only works if it’s a place people feel good about. These guidelines keep it kind, safe and honest for everyone — stylists and models alike. By using Cavy, you agree to follow them. Breaking them can mean losing access.',
  sections: [
    {
      heading: 'Be kind & respectful',
      blocks: [
        {
          type: 'p',
          text: 'Treat everyone the way you’d want to be treated. There’s no place here for harassment, bullying, hate speech, or discrimination of any kind — including based on race, religion, disability, gender, sexuality, or appearance. Disagreements happen; cruelty isn’t allowed.',
        },
      ],
    },
    {
      heading: 'Be honest & authentic',
      blocks: [
        {
          type: 'p',
          text: 'Be yourself, for real. Use genuine photos of you and your own work, keep your profile accurate, and only leave reviews for treatments that actually happened. No fake profiles, no impersonating someone else, no misleading claims about your experience or qualifications.',
        },
      ],
    },
    {
      heading: 'Stay safe when you meet',
      blocks: [
        { type: 'p', text: 'Treatments happen in person, so a little care goes a long way:' },
        {
          type: 'ul',
          items: [
            'Meet in a professional or public setting where you feel comfortable.',
            'Tell a friend or family member where you’re going and who you’re meeting.',
            'Keep chat and arrangements inside the app until you’re confident.',
            'Trust your instincts — if something feels off, you don’t have to go ahead.',
          ],
        },
      ],
    },
    {
      heading: 'Consent & boundaries',
      blocks: [
        {
          type: 'p',
          text: 'Beauty treatments involve physical contact, so consent matters. Be clear about what a treatment involves beforehand, respect people’s boundaries at all times, and stop if someone asks you to. Anything unwanted, inappropriate, or sexual in nature is not tolerated.',
        },
      ],
    },
    {
      heading: 'Adults only (18+)',
      blocks: [
        {
          type: 'p',
          text: 'Cavy is strictly for people aged 18 and over. Accounts found to belong to under-18s will be removed.',
        },
      ],
    },
    {
      heading: 'Child safety standards — zero tolerance',
      blocks: [
        {
          type: 'p',
          text: 'Cavy is a strictly adults-only (18+) service, and we have zero tolerance for child sexual abuse and exploitation (CSAE) of any kind. The following is expressly prohibited on Cavy, and any account involved will be permanently removed:',
        },
        {
          type: 'ul',
          items: [
            'Child sexual abuse material (CSAM), or any content that sexualises, endangers, or exploits a person under 18.',
            'Grooming, solicitation, or any attempt to sexualise, lure, or arrange contact with a minor.',
            'Sextortion, trafficking, or the sharing, requesting, or promotion of any such material or behaviour.',
            'Any use of the service by, or the creation of an account for, a person under 18.',
          ],
        },
        {
          type: 'p',
          text: 'How we enforce this: we act on reports of CSAE, and on any such material we become aware of, by removing the content and the account and preserving relevant information. We report child sexual abuse material and related conduct to the National Crime Agency’s CEOP Safety Centre and/or other relevant authorities, in line with UK law. Accounts we identify as belonging to under-18s are removed.',
        },
        {
          type: 'p',
          text: 'How to report: you can report any account or message in one tap inside the app, or email our child-safety point of contact directly at support@guineapigapp.co.uk. We treat these reports as our highest priority. If a child is in immediate danger, contact the police on 999 (in the UK) first.',
        },
      ],
    },
    {
      heading: 'No harmful or illegal behaviour',
      blocks: [
        {
          type: 'p',
          text: 'Don’t use Cavy for anything unlawful, fraudulent, or dangerous. That includes scams, spam, sharing someone’s private information without permission, or offering services you’re not permitted to provide.',
        },
      ],
    },
    {
      heading: 'Block, report & moderation',
      blocks: [
        {
          type: 'p',
          text: 'You’re always in control. You can block or report anyone in one tap, and our team reviews every report. Depending on what we find, we may warn, suspend, or permanently remove an account. Blocking someone stops them contacting you and hides you from each other.',
        },
      ],
    },
    {
      heading: 'If something goes wrong',
      blocks: [
        {
          type: 'p',
          text: 'Report it in the app, or email us any time at support@guineapigapp.co.uk — we take every report seriously. If you’re ever in immediate danger, contact the police on 999 (in the UK) first.',
        },
      ],
    },
  ],
}

/**
 * The two drafting placeholders this page used to carry — "[Confirm the full
 * list before launch.]" and "[Confirm your timeframe.]" — are now ANSWERED,
 * not just removed. 8 Aug 2026.
 *
 * Every claim below was checked against what the code actually does before it
 * was written, in this order:
 *
 *   * "removed straight away" — delete_account_data() deletes the user row,
 *     sessions, messages, reviews, notifications, providers and their children
 *     in ONE transaction, then storage across all four buckets.
 *   * "a record that you agreed to a treatment" — session_consents. This was
 *     only true from 8 Aug: until then ConsentGate displayed terms and
 *     persisted nothing, so there was no such record to keep.
 *   * "any moderation action" — moderation_actions.
 *   * "your first name, a scrambled version of your email" — subject_name and
 *     subject_email_hash (SHA-256, one-way). Deliberately precise: an earlier
 *     draft said these records hold no profile data, which was wrong.
 *   * "6 years" — enforced by guard_session_consents and
 *     guard_moderation_actions, which refuse deletion before then and permit
 *     it after. Not a promise a scheduled job has to remember to keep.
 *
 * The 30-day / 90-day contradiction that started this is resolved: 30 days,
 * with the two immutable records named explicitly as the exception. The
 * 90-day selfie retention is not mentioned because selfies are deleted with
 * the account, immediately, along with the other three buckets.
 *
 * ── REPORTS, ADDED 8 Aug 2026 WITH MIGRATION 0004 ─────────────────────────
 * Until 0004, delete_account_data deleted every report where the departing
 * user was EITHER party — so deleting your account destroyed other people's
 * complaints about you. This page could not have described that honestly. Now
 * reports survive with reporter_id / reported_id nulled and the denormalised
 * name and email hash retained, so the clause states what actually happens.
 *
 *   * "your first name and the same scrambled version of your email" —
 *     reported_name / reported_email_hash (and the reporter_* pair), populated
 *     by set_report_subjects() at insert and untouched by the deletion.
 *   * "if that same address ever signs up again, it matches" — the ban-evasion
 *     purpose, stated outright rather than left as an unexplained retention.
 *     It is the actual reason the hash exists (see
 *     moderation_actions.target_email_hash) and a policy that omits the real
 *     purpose is the kind of thing that reads badly later.
 *
 * THE 6 YEARS FOR REPORTS IS NOW STATED, AND EARNED. An earlier draft of this
 * page deliberately gave no number, because privacy-admin-access-clause.md:70
 * records the rule the hard way: a retention period nothing enforces is worse
 * than saying nothing. Both halves now exist —
 *
 *   * upper bound — run_retention_purge (migration 0005), scheduled monthly as
 *     the pg_cron job `retention-purge`, which deletes reports past 6 years.
 *     Proven against a back-dated row, not inferred from a dry run that
 *     returned zeros.
 *   * lower bound — guard_reports (migration 0006), which refuses deletion
 *     inside the 6 years, so nothing can remove a report early either.
 *
 * IF EITHER IS EVER REMOVED, THIS SENTENCE HAS TO GO BACK TO BEING VAGUE.
 * The admin dashboard's Retention Purge tile is what makes a silently stopped
 * job visible; without it, this page could go on claiming a deletion that had
 * quietly stopped happening.
 *
 * STILL OUTSTANDING: the app-scope privacy policy. PRIVACY (line ~297) says
 * plainly that it covers the waitlist and "does not yet cover the app", so the
 * retained-reports clause could not be added there — it belongs in the app
 * policy when that is written, and this page is currently the only place a
 * user can read it.
 */
export const DELETE_ACCOUNT: LegalDoc = {
  slug: 'delete-account',
  title: 'Request account & data deletion',
  metaTitle: 'Request account & data deletion',
  metaDescription:
    'How to delete your Cavy account and the data we hold about you.',
  // Bumped with the retained-reports clause. A legal page whose substance
  // changed under an unchanged revision date is its own small misstatement.
  updated: '8 August 2026',
  intro:
    'You’re always in control of your data. Here’s how to remove your Cavy account and everything we hold about you.',
  sections: [
    {
      heading: 'How to request deletion',
      blocks: [
        {
          type: 'p',
          text: 'In the app: Settings → Delete account. Or email us any time at support@guineapigapp.co.uk and we’ll handle it for you.',
        },
      ],
    },
    {
      heading: 'What gets deleted',
      blocks: [
        {
          type: 'p',
          text: 'Your profile, photos, messages and booking history are removed straight away. Anything left in our systems, including backups, is gone within 30 days.',
        },
      ],
    },
    {
      heading: 'What we keep, and why',
      blocks: [
        {
          type: 'p',
          text: 'Two things stay: a record that you agreed to a treatment, and any moderation action taken on your account. We keep these so we can respond to a safety concern or a legal claim.',
        },
        {
          type: 'p',
          text: 'They hold your first name, a scrambled version of your email address that we can’t read back, what you agreed to, and when. Not your photos, messages, or contact details. We keep them for up to 6 years, then delete them.',
        },
        {
          type: 'p',
          text: 'Reports also stay — both any report someone has made about you, and any report you made about someone else. A report is a record of something that happened between two people, so it isn’t only yours to remove. If reports disappeared whenever the person they were about left, reporting someone would stop being worth doing.',
        },
        {
          type: 'p',
          text: 'What stays on a report is your first name and the same scrambled version of your email address. Your account, contact details, photos and messages are all gone. We keep the scrambled email deliberately, and it’s fair that you know why: if that same address ever signs up again, it matches. It means a serious report can’t be cleared by deleting the account and starting over. We can’t turn it back into an email address, and we don’t use it for anything else.',
        },
        {
          type: 'p',
          text: 'We keep reports for up to 6 years, the same as the records above, and then delete them.',
        },
      ],
    },
    {
      heading: 'How long it takes',
      blocks: [
        {
          type: 'p',
          text: 'Deletion is immediate, and anything remaining is cleared within 30 days. The records described above are the only exception, and all of them are deleted after 6 years.',
        },
      ],
    },
    {
      heading: 'Questions',
      blocks: [
        {
          type: 'p',
          text: 'See our Privacy Policy for more on how we handle your data, or email support@guineapigapp.co.uk.',
        },
      ],
    },
  ],
}

export const LEGAL_DOCS = [TERMS, PRIVACY, COMMUNITY, DELETE_ACCOUNT] as const
