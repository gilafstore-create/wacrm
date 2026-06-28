import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/whatsapp/templates/list
 *
 * Returns APPROVED message_templates for the authenticated user.
 * Used by the automation builder's send_template step to populate
 * the searchable dropdown — replaces the free-text template name input.
 *
 * Response shape:
 *   { templates: { name, language, body_text, sample_values }[] }
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: templates, error } = await supabase
      .from('message_templates')
      .select('name, language, body_text, header_type, header_content, sample_values')
      .eq('user_id', user.id)
      .eq('status', 'APPROVED')
      .order('name', { ascending: true })

    if (error) {
      console.error('[templates/list] fetch failed:', error)
      return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
    }

    return NextResponse.json({ templates: templates ?? [] })
  } catch (err) {
    console.error('[templates/list] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
