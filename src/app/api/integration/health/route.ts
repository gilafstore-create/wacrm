import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * GET /api/integration/health
 * Health check endpoint for GilafStore to verify CRM connectivity.
 * 
 * Supports two modes:
 * 1. Without API key: Returns basic health status (HTTP 200)
 * 2. With API key: Returns detailed status including database info (HTTP 200)
 */
export async function GET(request: Request) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key')

    // If no API key, return basic health status
    if (!apiKey) {
      return NextResponse.json({
        success: true,
        status: 'ok',
        service: 'wacrm',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      }, { status: 200 })
    }

    // If API key provided, validate and return detailed status
    try {
      const admin = supabaseAdmin()
      const { data: keyRecord } = await admin
        .from('integration_keys')
        .select('id, key_name')
        .eq('api_key', apiKey)
        .eq('is_active', true)
        .maybeSingle()

      if (!keyRecord) {
        return NextResponse.json({
          success: false,
          status: 'error',
          message: 'Invalid API key',
          service: 'wacrm',
          timestamp: new Date().toISOString(),
        }, { status: 403 })
      }

      // Check Supabase connectivity
      const { count, error } = await admin
        .from('contacts')
        .select('*', { count: 'exact', head: true })

      return NextResponse.json({
        success: true,
        status: 'healthy',
        service: 'wacrm',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        database: error ? 'disconnected' : 'connected',
        contacts_count: count ?? 0,
      }, { status: 200 })
    } catch (dbError) {
      console.error('[integration/health] Database error:', dbError)
      return NextResponse.json({
        success: false,
        status: 'error',
        message: 'Database connection failed',
        service: 'wacrm',
        timestamp: new Date().toISOString(),
      }, { status: 500 })
    }
  } catch (error) {
    console.error('[integration/health] Error:', error)
    return NextResponse.json({
      success: false,
      status: 'error',
      message: 'Internal server error',
      service: 'wacrm',
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
