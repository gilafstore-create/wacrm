'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';

type Check = { ok: boolean; detail: string };
type DebugResponse = {
  allOk: boolean;
  summary: string;
  checks: Record<string, Check>;
  timestamp: string;
};

export default function WhatsAppDebugPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DebugResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runChecks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/debug');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">WhatsApp Connection Diagnostic</h1>
        <p className="text-sm text-slate-400 mt-1">
          Runs every check that can fail during Save Configuration. Shows the exact reason for any failure.
        </p>
      </div>

      <Button
        onClick={runChecks}
        disabled={loading}
        className="bg-purple-600 hover:bg-purple-700 text-white"
      >
        {loading ? (
          <><Loader2 className="size-4 mr-2 animate-spin" /> Running checks...</>
        ) : (
          <><RefreshCw className="size-4 mr-2" /> Run Diagnostic</>
        )}
      </Button>

      {error && (
        <div className="rounded-lg bg-rose-950 border-2 border-rose-500/60 p-4 text-rose-200 text-sm">
          <strong>Network error:</strong> {error}
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div
            className={`rounded-lg p-4 border-2 ${
              data.allOk
                ? 'bg-emerald-950 border-emerald-500/60 text-emerald-200'
                : 'bg-rose-950 border-rose-500/60 text-rose-200'
            }`}
          >
            <p className="font-semibold">
              {data.allOk ? '✓ All checks passed' : '✗ ' + data.summary}
            </p>
            <p className="text-xs opacity-70 mt-1">Run at {data.timestamp}</p>
          </div>

          <div className="space-y-2">
            {Object.entries(data.checks).map(([name, check]) => (
              <div
                key={name}
                className={`rounded-lg p-4 border ${
                  check.ok
                    ? 'bg-slate-900 border-slate-700'
                    : 'bg-rose-950/40 border-rose-500/40'
                }`}
              >
                <div className="flex items-start gap-3">
                  {check.ok ? (
                    <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="size-5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold text-white">
                      {name}
                    </p>
                    <pre
                      className={`text-xs mt-1 whitespace-pre-wrap break-all font-sans ${
                        check.ok ? 'text-slate-400' : 'text-rose-300'
                      }`}
                    >
                      {check.detail}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <details className="rounded-lg bg-slate-950 border border-slate-700 p-3">
            <summary className="text-xs text-slate-400 cursor-pointer">Raw JSON</summary>
            <pre className="text-xs text-slate-300 mt-2 overflow-x-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
