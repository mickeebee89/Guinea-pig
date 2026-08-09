import { notFound } from 'next/navigation'
import { createSupabaseServerClient, getUser } from '@/lib/supabase-server'
import { getThread } from '@/lib/queries/thread'
import { ChatThread } from './ChatThread'

export const metadata = { title: 'Conversation' }

/**
 * Server-rendered thread, handed to a Client Component that takes over for
 * realtime.
 *
 * The initial messages come from the server so the conversation is in the HTML
 * on first paint — no loading flash, and the session is verified server-side
 * before anything renders.
 *
 * A thread that doesn't exist and a thread that isn't yours both arrive here as
 * null, and both 404. Distinguishing them would turn this route into an
 * existence oracle for other people's bookings.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const user = await getUser()
  const supabase = await createSupabaseServerClient()

  const thread = await getThread(supabase, sessionId, user!.id)
  if (!thread) notFound()

  return <ChatThread thread={thread} userId={user!.id} />
}
