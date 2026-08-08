import { signOut } from '@/lib/auth-actions'

/** A real form POST, so it works without JavaScript and cannot be fired by a
 *  cross-site GET. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={
          className ??
          'inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-5 text-sm font-bold text-rose transition-colors hover:bg-rose hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose'
        }
      >
        Sign out
      </button>
    </form>
  )
}
