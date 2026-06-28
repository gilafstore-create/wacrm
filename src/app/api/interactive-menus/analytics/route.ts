import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const menuId = searchParams.get('menu_id')
  const days = Math.min(90, parseInt(searchParams.get('days') ?? '30', 10))

  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  let query = supabase
    .from('interactive_interactions')
    .select('option_id, option_title, created_at')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (menuId) query = query.eq('menu_id', menuId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const totalTaps = rows.length

  const byOption: Record<string, { title: string; count: number }> = {}
  for (const row of rows) {
    const key = row.option_id ?? 'unknown'
    if (!byOption[key]) byOption[key] = { title: row.option_title ?? key, count: 0 }
    byOption[key].count++
  }

  const breakdown = Object.entries(byOption)
    .map(([id, v]) => ({ option_id: id, title: v.title, count: v.count, pct: totalTaps > 0 ? Math.round((v.count / totalTaps) * 100) : 0 }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ total_taps: totalTaps, breakdown, period_days: days })
}
