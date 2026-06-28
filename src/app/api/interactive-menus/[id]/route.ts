import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('interactive_menus')
    .select('*, interactive_menu_options(* order(sort_order asc))')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ menu: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, menu_type, body: bodyText, header, footer, button_text, options } = body

  const { error: menuErr } = await supabase
    .from('interactive_menus')
    .update({ name, menu_type, body: bodyText, header, footer, button_text, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
  if (menuErr) return NextResponse.json({ error: menuErr.message }, { status: 500 })

  if (options) {
    await supabase.from('interactive_menu_options').delete().eq('menu_id', id)
    const rows = (options as { id: string; title: string; description?: string }[]).map((o, i) => ({
      menu_id: id,
      option_id: o.id,
      title: o.title,
      description: o.description,
      sort_order: i,
    }))
    await supabase.from('interactive_menu_options').insert(rows)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('interactive_menus')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
