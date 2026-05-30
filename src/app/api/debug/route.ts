import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * GET /api/debug
 * Comprehensive debug endpoint for troubleshooting CRM integration
 * Returns detailed system information and connection status
 */
export async function GET(request: Request) {
  try {
    const startTime = Date.now()
    const debugInfo: any = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
    }

    // Check environment variables
    debugInfo.env = {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ Set' : '✗ Missing',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✓ Set' : '✗ Missing',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Set' : '✗ Missing',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? '✓ Set' : '✗ Missing',
      META_APP_SECRET: process.env.META_APP_SECRET ? '✓ Set' : '✗ Missing',
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'Not set',
    }

    // Check Supabase connectivity
    try {
      const admin = supabaseAdmin()
      const { data, error } = await admin
        .from('contacts')
        .select('count', { count: 'exact', head: true })

      debugInfo.supabase = {
        status: error ? 'Error' : 'Connected',
        error: error?.message || null,
        contactsCount: data?.length || 0,
      }
    } catch (err: any) {
      debugInfo.supabase = {
        status: 'Error',
        error: err?.message || 'Unknown error',
      }
    }

    // Check integration_keys table
    try {
      const admin = supabaseAdmin()
      const { data, error } = await admin
        .from('integration_keys')
        .select('id, key_name, is_active')
        .limit(5)

      debugInfo.integrationKeys = {
        status: error ? 'Error' : 'Connected',
        error: error?.message || null,
        count: data?.length || 0,
        keys: data?.map((k: any) => ({
          name: k.key_name,
          active: k.is_active,
        })) || [],
      }
    } catch (err: any) {
      debugInfo.integrationKeys = {
        status: 'Error',
        error: err?.message || 'Unknown error',
      }
    }

    // Check API routes
    debugInfo.routes = {
      health: '/api/health',
      integrationHealth: '/api/integration/health',
      debug: '/api/debug',
      whatsappWebhook: '/api/whatsapp/webhook',
      integrationWebhook: '/api/integration/webhook',
    }

    // Request headers
    debugInfo.requestHeaders = {
      userAgent: request.headers.get('user-agent'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
      xForwardedFor: request.headers.get('x-forwarded-for'),
      xForwardedProto: request.headers.get('x-forwarded-proto'),
    }

    // Performance metrics
    debugInfo.performance = {
      responseTimeMs: Date.now() - startTime,
    }

    return NextResponse.json(
      {
        success: true,
        status: 'debug',
        service: 'wacrm',
        debug: debugInfo,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('[debug] Error:', error)
    return NextResponse.json(
      {
        success: false,
        status: 'error',
        message: error?.message || 'Internal server error',
        error: {
          name: error?.name,
          message: error?.message,
          stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
        },
      },
      { status: 500 }
    )
  }
}
