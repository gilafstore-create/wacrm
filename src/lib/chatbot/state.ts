import { supabaseAdmin } from '@/lib/automations/admin-client'

export interface FlowState {
  /** Top-level flow: 'idle' | 'track_order' | 'products' | 'returns' | 'support' | 'feedback' | 'app_store' */
  flow: string
  /** Sub-step within a flow, e.g. 'waiting_order_select' */
  step: string | null
  /** Arbitrary key-value context persisted between turns */
  context: Record<string, unknown>
}

const IDLE: FlowState = { flow: 'idle', step: null, context: {} }

export async function getFlowState(contactId: string): Promise<FlowState> {
  const { data } = await supabaseAdmin()
    .from('contact_flow_state')
    .select('flow, step, context')
    .eq('contact_id', contactId)
    .maybeSingle()
  if (!data) return { ...IDLE }
  return {
    flow: (data.flow as string) ?? 'idle',
    step: (data.step as string | null) ?? null,
    context: (data.context as Record<string, unknown>) ?? {},
  }
}

export async function setFlowState(
  userId: string,
  contactId: string,
  patch: Partial<FlowState>,
): Promise<void> {
  const current = await getFlowState(contactId)
  const next: FlowState = {
    flow: patch.flow ?? current.flow,
    step: patch.step !== undefined ? patch.step : current.step,
    context: patch.context !== undefined ? patch.context : current.context,
  }
  await supabaseAdmin()
    .from('contact_flow_state')
    .upsert(
      {
        user_id: userId,
        contact_id: contactId,
        flow: next.flow,
        step: next.step,
        context: next.context,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contact_id' },
    )
}

export async function resetFlowState(userId: string, contactId: string): Promise<void> {
  await setFlowState(userId, contactId, { ...IDLE })
}
