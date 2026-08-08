import type { Metadata } from 'next'
import { ForgotForm } from './ForgotForm'

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false, follow: true } }

export default function ForgotPasswordPage() {
  return (
    <section className="mx-auto max-w-md px-6 py-12 sm:py-16">
      <h1 className="font-display text-4xl text-warm-dark">Reset your password</h1>
      <p className="mt-2 text-muted">We’ll email you a link to choose a new one.</p>
      <ForgotForm />
    </section>
  )
}
