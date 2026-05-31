"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Database, Save, RefreshCw, Eye, EyeOff, Copy,
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  Shield, Info, ExternalLink, KeyRound, Globe,
  Server, Zap, HardDrive, FunctionSquare,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfigState {
  supabase_project_url: string;
  supabase_anon_key: string;
  supabase_service_role_key: string;
  supabase_jwt_secret: string;
  supabase_db_url: string;
  supabase_realtime_url: string;
  supabase_storage_bucket: string;
  supabase_storage_url: string;
  supabase_functions_url: string;
  supabase_project_ref: string;
}

interface TestResult {
  success: boolean;
  checks: Record<string, boolean | string>;
  message: string;
}

const EMPTY_CONFIG: ConfigState = {
  supabase_project_url: "",
  supabase_anon_key: "",
  supabase_service_role_key: "",
  supabase_jwt_secret: "",
  supabase_db_url: "",
  supabase_realtime_url: "",
  supabase_storage_bucket: "",
  supabase_storage_url: "",
  supabase_functions_url: "",
  supabase_project_ref: "",
};

const SENSITIVE_FIELDS = new Set([
  "supabase_service_role_key",
  "supabase_jwt_secret",
  "supabase_db_url",
]);

// ─── Field groups ─────────────────────────────────────────────────────────────

const FIELD_GROUPS = [
  {
    title: "Core Connection",
    icon: Globe,
    color: "text-emerald-400",
    fields: [
      {
        key: "supabase_project_url" as keyof ConfigState,
        label: "Project URL",
        placeholder: "https://xxxxxxxxxxxx.supabase.co",
        hint: "Found in Project Settings → API → Project URL",
        sensitive: false,
      },
      {
        key: "supabase_project_ref" as keyof ConfigState,
        label: "Project Reference",
        placeholder: "xxxxxxxxxxxx",
        hint: "The 20-character ID in your project URL",
        sensitive: false,
      },
    ],
  },
  {
    title: "API Keys",
    icon: KeyRound,
    color: "text-blue-400",
    fields: [
      {
        key: "supabase_anon_key" as keyof ConfigState,
        label: "Anon / Public Key",
        placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
        hint: "Safe to use in browser code. Found in Project Settings → API",
        sensitive: false,
      },
      {
        key: "supabase_service_role_key" as keyof ConfigState,
        label: "Service Role Key",
        placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
        hint: "🔴 NEVER expose to frontend. Bypasses all RLS. Server-side only.",
        sensitive: true,
      },
      {
        key: "supabase_jwt_secret" as keyof ConfigState,
        label: "JWT Secret",
        placeholder: "your-super-secret-jwt-token-with-at-least-32-characters-long",
        hint: "🔴 Used to sign JWTs. Never expose publicly.",
        sensitive: true,
      },
    ],
  },
  {
    title: "Database",
    icon: Server,
    color: "text-purple-400",
    fields: [
      {
        key: "supabase_db_url" as keyof ConfigState,
        label: "Database URL (Connection String)",
        placeholder: "postgresql://postgres:[password]@db.xxxx.supabase.co:5432/postgres",
        hint: "🔴 Contains your DB password. Server-side only. Found in Settings → Database",
        sensitive: true,
      },
    ],
  },
  {
    title: "Services",
    icon: Zap,
    color: "text-amber-400",
    fields: [
      {
        key: "supabase_realtime_url" as keyof ConfigState,
        label: "Realtime URL",
        placeholder: "wss://xxxxxxxxxxxx.supabase.co/realtime/v1",
        hint: "WebSocket URL for real-time subscriptions",
        sensitive: false,
      },
      {
        key: "supabase_functions_url" as keyof ConfigState,
        label: "Edge Functions URL",
        placeholder: "https://xxxxxxxxxxxx.supabase.co/functions/v1",
        hint: "Base URL for invoking Edge Functions",
        sensitive: false,
      },
    ],
  },
  {
    title: "Storage",
    icon: HardDrive,
    color: "text-rose-400",
    fields: [
      {
        key: "supabase_storage_bucket" as keyof ConfigState,
        label: "Default Storage Bucket",
        placeholder: "public",
        hint: "Name of your primary storage bucket",
        sensitive: false,
      },
      {
        key: "supabase_storage_url" as keyof ConfigState,
        label: "Storage URL",
        placeholder: "https://xxxxxxxxxxxx.supabase.co/storage/v1",
        hint: "Base URL for storage API",
        sensitive: false,
      },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SupabaseIntgPage() {
  const [config, setConfig] = useState<ConfigState>(EMPTY_CONFIG);
  const [savedConfig, setSavedConfig] = useState<ConfigState>(EMPTY_CONFIG);
  const [lastUpdated, setLastUpdated] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // ── Load config ─────────────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/supabase-config");
      const data = await res.json();
      if (data.success) {
        setConfig(data.config ?? EMPTY_CONFIG);
        setSavedConfig(data.config ?? EMPTY_CONFIG);
        setLastUpdated(data.lastUpdated ?? {});
        setConfigured(data.configured ?? false);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    setMigrationNeeded(false);
    try {
      const res = await fetch("/api/admin/supabase-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.migration_needed) {
        setMigrationNeeded(true);
        setSaveMsg({ type: "error", text: "Database migration required. See instructions below." });
      } else if (data.success) {
        setSaveMsg({ type: "success", text: data.message ?? "Saved successfully." });
        setSavedConfig({ ...config });
        setConfigured(true);
        await loadConfig(); // reload to get masked secrets
      } else {
        setSaveMsg({ type: "error", text: data.error ?? "Save failed." });
      }
    } catch {
      setSaveMsg({ type: "error", text: "Network error — please try again." });
    } finally {
      setSaving(false);
    }
  };

  // ── Test ────────────────────────────────────────────────────────────────────

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/supabase-config?action=test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_url: config.supabase_project_url,
          anon_key: config.supabase_anon_key,
          service_role_key: config.supabase_service_role_key,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, checks: {}, message: "Network error." });
    } finally {
      setTesting(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const toggleVisible = (key: string) => {
    setVisibleFields(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const copyToClipboard = async (key: string, value: string) => {
    if (value.includes("••")) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isDirty = JSON.stringify(config) !== JSON.stringify(savedConfig);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <Database className="h-5 w-5 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Supabase Integration</h1>
            {configured && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Configured
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 ml-13">
            Store and manage all Supabase credentials securely. Sensitive keys are encrypted server-side and never exposed to the browser.
          </p>
        </div>
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Supabase Dashboard
        </a>
      </div>

      {/* Security notice */}
      <div className="flex gap-3 rounded-xl bg-slate-800/60 border border-slate-700/50 p-4">
        <Shield className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-400 space-y-1">
          <p className="text-amber-300 font-medium">Security Architecture</p>
          <p>All credentials are stored in the <code className="text-xs bg-slate-700 px-1 rounded">app_config</code> table with RLS. Sensitive values (Service Role Key, JWT Secret, DB URL) are <strong className="text-white">never returned in full</strong> — only a masked prefix is shown after saving. They are used exclusively on the server.</p>
        </div>
      </div>

      {/* Migration notice */}
      {migrationNeeded && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-rose-400 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Database Table Missing — Run this SQL in Supabase SQL Editor
          </div>
          <pre className="text-xs text-slate-300 bg-slate-900 rounded-lg p-3 overflow-x-auto">{`CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read/write
CREATE POLICY "auth_users_only" ON public.app_config
  FOR ALL USING (auth.role() = 'authenticated');`}
          </pre>
          <a
            href="https://supabase.com/dashboard/project/_/sql"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
          >
            <ExternalLink className="h-4 w-4" /> Open SQL Editor
          </a>
        </div>
      )}

      {/* Save/error message */}
      {saveMsg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
          saveMsg.type === "success"
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
        }`}>
          {saveMsg.type === "success"
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <XCircle className="h-4 w-4 shrink-0" />
          }
          {saveMsg.text}
        </div>
      )}

      {/* Field groups */}
      {FIELD_GROUPS.map(group => {
        const GroupIcon = group.icon;
        return (
          <div key={group.title} className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
            {/* Group header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-800 bg-slate-800/40">
              <GroupIcon className={`h-4 w-4 ${group.color}`} />
              <span className={`text-sm font-semibold ${group.color}`}>{group.title}</span>
            </div>

            {/* Fields */}
            <div className="divide-y divide-slate-800">
              {group.fields.map(field => {
                const isVisible = visibleFields.has(field.key);
                const isMasked = config[field.key]?.includes("••");
                const isSensitive = field.sensitive;
                const inputType = isSensitive && !isVisible ? "password" : "text";
                const lastUpd = lastUpdated[field.key];

                return (
                  <div key={field.key} className="px-5 py-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                        {field.label}
                        {isSensitive && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">
                            SECRET
                          </span>
                        )}
                      </label>
                      {lastUpd && (
                        <span className="text-[10px] text-slate-500">
                          saved {new Date(lastUpd).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    <div className="relative flex gap-2">
                      <input
                        type={inputType}
                        value={config[field.key]}
                        onChange={e => setConfig(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        className="flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-700 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 font-mono transition-colors"
                      />
                      {/* Show/hide toggle for sensitive */}
                      {isSensitive && (
                        <button
                          type="button"
                          onClick={() => toggleVisible(field.key)}
                          title={isVisible ? "Hide" : "Show"}
                          className="flex items-center justify-center h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors shrink-0"
                        >
                          {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                      {/* Copy button (non-masked only) */}
                      {!isMasked && config[field.key] && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(field.key, config[field.key])}
                          title="Copy"
                          className="flex items-center justify-center h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors shrink-0"
                        >
                          {copiedKey === field.key
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            : <Copy className="h-4 w-4" />
                          }
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 flex items-start gap-1.5">
                      <Info className="h-3 w-3 mt-0.5 shrink-0" />
                      {field.hint}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Test connection */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-400">Test Connection</span>
          </div>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !config.supabase_project_url || !config.supabase_anon_key}
            className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {testing ? "Testing…" : "Run Test"}
          </button>
        </div>

        {testResult && (
          <div className={`rounded-lg p-4 space-y-3 ${testResult.success ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-rose-500/10 border border-rose-500/20"}`}>
            <p className={`text-sm font-medium ${testResult.success ? "text-emerald-300" : "text-rose-300"}`}>
              {testResult.success ? "✅ " : "❌ "}{testResult.message}
            </p>
            {Object.entries(testResult.checks).length > 0 && (
              <div className="space-y-1.5">
                {Object.entries(testResult.checks).map(([check, result]) => (
                  <div key={check} className="flex items-center gap-2 text-xs">
                    {result === true
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    }
                    <span className="text-slate-400 capitalize">{check.replace(/_/g, " ")}</span>
                    {typeof result === "string" && (
                      <span className="text-rose-400 truncate">{result}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-900 border border-slate-800 px-5 py-4">
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5" />
          Secrets are stored server-side only. Service Role Key &amp; JWT Secret are never returned in full.
        </p>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save Configuration"}
          </button>
        </div>
      </div>

    </div>
  );
}
