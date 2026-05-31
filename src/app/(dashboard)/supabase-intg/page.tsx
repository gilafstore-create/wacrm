"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Database, Save, Eye, EyeOff, Copy, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Shield, Info, ExternalLink, KeyRound,
  Sparkles, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfigState {
  supabase_project_url: string;
  supabase_anon_key: string;
  supabase_service_role_key: string;
  encryption_key: string;
}

const EMPTY: ConfigState = {
  supabase_project_url: "",
  supabase_anon_key: "",
  supabase_service_role_key: "",
  encryption_key: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SupabaseIntgPage() {
  const [form, setForm]               = useState<ConfigState>(EMPTY);
  const [saved, setSaved]             = useState<ConfigState>(EMPTY);
  const [lastUpdated, setLastUpdated] = useState<Record<string, string>>({});
  const [showSrk, setShowSrk]         = useState(false);
  const [showEnc, setShowEnc]         = useState(false);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [configured, setConfigured]   = useState(false);
  const [copied, setCopied]           = useState<string | null>(null);
  const [saveMsg, setSaveMsg]         = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/supabase-config");
      const data = await res.json();
      if (data.success) {
        const c: ConfigState = {
          supabase_project_url:    data.config?.supabase_project_url    ?? "",
          supabase_anon_key:       data.config?.supabase_anon_key       ?? "",
          supabase_service_role_key: data.config?.supabase_service_role_key ?? "",
          encryption_key:          data.config?.encryption_key          ?? "",
        };
        setForm(c);
        setSaved(c);
        setLastUpdated(data.lastUpdated ?? {});
        setConfigured(data.configured ?? false);
      }
    } catch { /* ignore */ }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Generate encryption key ───────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    setSaveMsg(null);
    try {
      const res  = await fetch("/api/admin/supabase-config?action=generate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_url:      form.supabase_project_url,
          anon_key:         form.supabase_anon_key,
          service_role_key: form.supabase_service_role_key,
        }),
      });
      const data = await res.json();
      if (data.success && data.encryption_key) {
        setForm(prev => ({ ...prev, encryption_key: data.encryption_key }));
        setSaveMsg({ type: "success", text: "Encryption key generated! Review it then click Save Configuration." });
      } else {
        setSaveMsg({ type: "error", text: data.error ?? "Key generation failed." });
      }
    } catch {
      setSaveMsg({ type: "error", text: "Network error — please try again." });
    } finally {
      setGenerating(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.supabase_project_url.trim()) {
      setSaveMsg({ type: "error", text: "Project URL is required." });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    setMigrationNeeded(false);
    try {
      const res  = await fetch("/api/admin/supabase-config", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (data.migration_needed) {
        setMigrationNeeded(true);
        setSaveMsg({ type: "error", text: "app_config table missing — see SQL below." });
      } else if (data.success) {
        setSaveMsg({ type: "success", text: data.message ?? "Configuration saved." });
        setConfigured(true);
        await load();
      } else {
        setSaveMsg({ type: "error", text: data.error ?? "Save failed." });
      }
    } catch {
      setSaveMsg({ type: "error", text: "Network error — please try again." });
    } finally {
      setSaving(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const copyVal = async (key: string, val: string) => {
    if (!val || val.includes("••")) return;
    await navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const set = (key: keyof ConfigState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  const canGenerate =
    form.supabase_project_url.trim().length > 0 &&
    form.supabase_anon_key.trim().length > 0 &&
    form.supabase_service_role_key.trim().length > 0 &&
    !form.supabase_service_role_key.includes("••");

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-12">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
            <Database className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">Supabase Integration</h1>
              {configured && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                  <CheckCircle2 className="h-3 w-3" /> Configured
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Enter your credentials, then auto-generate the Encryption Key.</p>
          </div>
        </div>
        <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors shrink-0">
          <ExternalLink className="h-3.5 w-3.5" /> Supabase Dashboard
        </a>
      </div>

      {/* ── Status message ── */}
      {saveMsg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
          saveMsg.type === "success"
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
        }`}>
          {saveMsg.type === "success"
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <XCircle className="h-4 w-4 shrink-0" />}
          {saveMsg.text}
        </div>
      )}

      {/* ── Migration SQL ── */}
      {migrationNeeded && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-400">
            <AlertTriangle className="h-4 w-4" /> Run this SQL in your Supabase SQL Editor first:
          </p>
          <pre className="text-xs text-slate-300 bg-slate-900 rounded-lg p-3 overflow-x-auto">{`CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users_only" ON public.app_config
  FOR ALL USING (auth.role() = 'authenticated');`}
          </pre>
          <a href="https://supabase.com/dashboard/project/_/sql" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300">
            <ExternalLink className="h-4 w-4" /> Open SQL Editor
          </a>
        </div>
      )}

      {/* ── Main card ── */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">

        {/* Step 1–3 header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-800 bg-slate-800/40">
          <KeyRound className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold text-blue-400">Step 1 — Enter Supabase credentials</span>
        </div>

        <div className="divide-y divide-slate-800">

          {/* 1. Project URL */}
          <Field
            label="Project URL"
            hint="Found in Supabase → Project Settings → API → Project URL"
            lastSaved={lastUpdated["supabase_project_url"]}
          >
            <input
              type="text"
              value={form.supabase_project_url}
              onChange={set("supabase_project_url")}
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              autoComplete="off" spellCheck={false}
              className={inputCls}
            />
            <CopyBtn value={form.supabase_project_url} id="url" copied={copied} onCopy={copyVal} />
          </Field>

          {/* 2. Anon / Public Key */}
          <Field
            label="Anon / Public Key"
            hint="Safe to use in browser code. Found in Project Settings → API"
            lastSaved={lastUpdated["supabase_anon_key"]}
          >
            <input
              type="text"
              value={form.supabase_anon_key}
              onChange={set("supabase_anon_key")}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              autoComplete="off" spellCheck={false}
              className={inputCls}
            />
            <CopyBtn value={form.supabase_anon_key} id="anon" copied={copied} onCopy={copyVal} />
          </Field>

          {/* 3. Service Role Key */}
          <Field
            label="Service Role Key"
            secret
            hint="🔴 Never expose to frontend — bypasses all RLS. Found in Project Settings → API"
            lastSaved={lastUpdated["supabase_service_role_key"]}
          >
            <input
              type={showSrk ? "text" : "password"}
              value={form.supabase_service_role_key}
              onChange={set("supabase_service_role_key")}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              autoComplete="off" spellCheck={false}
              className={inputCls}
            />
            <ToggleBtn show={showSrk} onToggle={() => setShowSrk(v => !v)} />
          </Field>

        </div>

        {/* Step 2 header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-b border-slate-800 bg-slate-800/40">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-400">Step 2 — Auto-generate Encryption Key</span>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            Click <strong className="text-white">Generate Key</strong> to create a cryptographically secure 64-character hex key derived from your credentials.
            This replaces the old <code className="text-xs bg-slate-800 px-1 rounded">node -e &quot;console.log(require(&apos;crypto&apos;)...)&quot;</code> command — no terminal needed.
          </p>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !canGenerate}
            className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Sparkles className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate Encryption Key"}
          </button>

          {!canGenerate && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Fill in Project URL, Anon Key and Service Role Key first, then generate.
            </p>
          )}

          {/* Encryption Key display */}
          {form.encryption_key && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  Encryption Key
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">SECRET</span>
                </label>
                {lastUpdated["encryption_key"] && (
                  <span className="text-[10px] text-slate-500">saved {new Date(lastUpdated["encryption_key"]).toLocaleDateString()}</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type={showEnc ? "text" : "password"}
                  value={form.encryption_key}
                  onChange={set("encryption_key")}
                  autoComplete="off" spellCheck={false}
                  className={inputCls + " font-mono"}
                  readOnly={form.encryption_key.includes("••")}
                />
                <ToggleBtn show={showEnc} onToggle={() => setShowEnc(v => !v)} />
                {!form.encryption_key.includes("••") && (
                  <CopyBtn value={form.encryption_key} id="enc" copied={copied} onCopy={copyVal} />
                )}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  title="Re-generate"
                  className="flex items-center justify-center h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-500/40 transition-colors shrink-0 disabled:opacity-40"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500 flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                🔴 This key encrypts all tokens at rest. Save it — it cannot be recovered once masked.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Security note ── */}
      <div className="flex gap-3 rounded-xl bg-slate-800/60 border border-slate-700/50 p-4">
        <Shield className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400">
          <span className="text-amber-300 font-medium">Storage: </span>
          All values are saved to the <code className="bg-slate-700 px-1 rounded">app_config</code> table with RLS.
          The Service Role Key and Encryption Key are <strong className="text-white">never returned in full</strong> after saving — only a masked prefix is shown.
        </p>
      </div>

      {/* ── Action bar ── */}
      <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-900 border border-slate-800 px-5 py-4">
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Unsaved changes
            </span>
          )}
        </div>
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
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const inputCls =
  "flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-700 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors h-10";

function Field({
  label, secret = false, hint, lastSaved, children,
}: {
  label: string; secret?: boolean; hint: string; lastSaved?: string; children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
          {label}
          {secret && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">
              SECRET
            </span>
          )}
        </label>
        {lastSaved && (
          <span className="text-[10px] text-slate-500">saved {new Date(lastSaved).toLocaleDateString()}</span>
        )}
      </div>
      <div className="flex gap-2">{children}</div>
      <p className="text-xs text-slate-500 flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />{hint}
      </p>
    </div>
  );
}

function ToggleBtn({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className="flex items-center justify-center h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors shrink-0">
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function CopyBtn({ value, id, copied, onCopy }: {
  value: string; id: string; copied: string | null;
  onCopy: (id: string, val: string) => void;
}) {
  if (!value || value.includes("••")) return null;
  return (
    <button type="button" onClick={() => onCopy(id, value)}
      className="flex items-center justify-center h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors shrink-0">
      {copied === id ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
