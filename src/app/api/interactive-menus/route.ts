import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('interactive_menus')
    .select('*, interactive_menu_options(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ menus: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, menu_type, body: bodyText, header, footer, button_text, options } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!bodyText?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 })
  if (!options?.length) return NextResponse.json({ error: 'at least one option required' }, { status: 400 })

  const { data: menu, error: menuErr } = await supabase
    .from('interactive_menus')
    .insert({ user_id: user.id, name, menu_type: menu_type ?? 'buttons', body: bodyText, header, footer, button_text })
    .select()
    .single()
  if (menuErr || !menu) return NextResponse.json({ error: menuErr?.message ?? 'insert failed' }, { status: 500 })

  const rows = (options as { id: string; title: string; description?: string }[]).map((o, i) => ({
    menu_id: menu.id,
    option_id: o.id,
    title: o.title,
    description: o.description,
    sort_order: i,
  }))
  const { error: optErr } = await supabase.from('interactive_menu_options').insert(rows)
  if (optErr) return NextResponse.json({ error: optErr.message }, { status: 500 })

  return NextResponse.json({ menu })
}
