import { NextResponse } from 'next/server'

/**
 * GET /api/health
 * Simple health check endpoint - no authentication required
 * Used by GilafStore to verify WACRM is running
 */
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      status: 'ok',
      service: 'wacrm',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }, { status: 200 })
  } catch (error) {
    console.error('[health] Error:', error)
    return NextResponse.json({
      success: false,
      status: 'error',
      message: 'Internal server error',
    }, { status: 500 })
  }
}
