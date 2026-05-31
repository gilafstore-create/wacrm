"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  Globe, Plus, CheckCircle2, XCircle, RefreshCw,
  Zap, Webhook, Clock, Shield, Eye, EyeOff, Copy,
  ChevronRight, Trash2, Activity, Wifi, Search,
  RotateCcw, Play, Loader2, Info, ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Integration {
  id: string;
  website_name: string;
  website_url: string;
  platform: string;
  status: "pending" | "active" | "warning" | "error" | "disabled";
  health_score: number;
  webhook_url: string | null;
  webhook_events: string[];
  auto_sync_enabled: boolean;
  sync_interval_min: number;
  heartbeat_enabled: boolean;
  last_heartbeat_at: string | null;
  heartbeat_latency_ms: number | null;
  last_sync_at: string | null;
  last_error: string | null;
  total_webhooks_sent: number;
  total_webhooks_failed: number;
  total_synced_contacts: number;
  total_synced_orders: number;
  discovered_version: string | null;
  created_at: string;
  website_api_key: string;
  connection_token: string | null;
}

interface WebhookDelivery {
  id: string;
  event_type: string;
  http_status: number;
  duration_ms: number;
  status: string;
  attempt: number;
  error_message: string | null;
  created_at: string;
}

type View = "list" | "add" | "detail";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_EVENTS = [
  "customer.created", "customer.updated",
  "order.placed", "order.confirmed", "order.packed",
  "order.shipped", "order.delivered", "order.cancelled",
  "payment.success", "payment.failed",
  "cart.abandoned", "cart.recovered",
  "otp.requested", "otp.verified",
];

const PLATFORMS = [
  { value: "custom",      label: "Custom / PHP" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "shopify",     label: "Shopify" },
  { value: "magento",     label: "Magento" },
  { value: "opencart",    label: "OpenCart" },
  { value: "prestashop",  label: "PrestaShop" },
];

const STATUS_CONFIG = {
  active:   { color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", dot: "bg-emerald-400", label: "Active" },
  pending:  { color: "text-amber-400",   bg: "bg-amber-400/10 border-amber-400/30",     dot: "bg-amber-400",   label: "Pending" },
  warning:  { color: "text-orange-400",  bg: "bg-orange-400/10 border-orange-400/30",   dot: "bg-orange-400",  label: "Warning" },
  error:    { color: "text-red-400",     bg: "bg-red-400/10 border-red-400/30",         dot: "bg-red-400",     label: "Error" },
  disabled: { color: "text-slate-500",   bg: "bg-slate-700/30 border-slate-700",        dot: "bg-slate-500",   label: "Disabled" },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    const t = document.createElement("div");
    t.className = "fixed bottom-6 right-6 z-50 rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-sm text-white shadow-xl";
    t.textContent = "✓ Copied!";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  });
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-700">
        <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-400">{score}</span>
    </div>
  );
}

// ─── Add / Edit Form ──────────────────────────────────────────────────────────

function AddIntegrationForm({ onCreated }: { onCreated: (data: Record<string, unknown>) => void }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    website_name: "", website_url: "", platform: "custom",
    website_api_key: "", webhook_url: "",
    webhook_events: ["order.placed", "order.shipped", "otp.requested", "cart.abandoned"],
  });

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const toggleEvent = (ev: string) => {
    setForm(f => ({
      ...f,
      webhook_events: f.webhook_events.includes(ev)
        ? f.webhook_events.filter(e => e !== ev)
        : [...f.webhook_events, ev],
    }));
  };

  const autoDiscover = async () => {
    if (!form.website_url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_url: form.website_url, website_api_key: form.website_api_key }),
      });
      const data = await r.json();
      setTestResult(data);
      if (data.platform && data.platform !== "custom") set("platform", data.platform);
    } catch { setTestResult({ error: "Network error" }); }
    setTesting(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (data.success) onCreated(data);
      else alert(data.error ?? "Failed to create");
    } catch { alert("Network error"); }
    setSaving(false);
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-0">
        {[1, 2, 3, 4].map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <button
              onClick={() => s < step && setStep(s)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all ${
                s < step  ? "bg-emerald-500 text-white cursor-pointer"
                : s === step ? "bg-violet-600 text-white ring-2 ring-violet-400/40"
                : "bg-slate-800 text-slate-500"
              }`}
            >{s < step ? "✓" : s}</button>
            {i < 3 && <div className={`flex-1 h-0.5 mx-1 ${s < step ? "bg-emerald-500" : "bg-slate-800"}`} />}
          </div>
        ))}
      </div>
      <div className="mb-6 flex gap-2 text-[11px] text-slate-500 justify-between">
        {["Website Info", "API Key", "Webhooks", "Confirm"].map(l => (
          <span key={l} className="flex-1 text-center">{l}</span>
        ))}
      </div>

      {/* Step 1: Website Info */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Website Name *</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
              placeholder="GilafStore" value={form.website_name}
              onChange={e => set("website_name", e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Website URL *</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
              placeholder="https://yourstore.com" value={form.website_url}
              onChange={e => set("website_url", e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">No trailing slash. Must be accessible from the internet.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Platform</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              value={form.platform} onChange={e => set("platform", e.target.value)}
            >
              {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <button
            onClick={autoDiscover} disabled={!form.website_url || testing}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 py-2.5 text-sm font-medium text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Auto Detect Platform &amp; Endpoints
          </button>
          {testResult && (
            <div className={`rounded-lg border p-3 text-sm ${
              (testResult.connected as boolean)
                ? "border-emerald-500/30 bg-emerald-500/10"
                : (testResult.site_reachable as boolean)
                ? "border-blue-500/30 bg-blue-500/10"
                : "border-amber-500/30 bg-amber-500/10"
            }`}>
              <p className={
                (testResult.connected as boolean) ? "text-emerald-300"
                : (testResult.site_reachable as boolean) ? "text-blue-300"
                : "text-amber-300"
              }>
                {(testResult.connected as boolean) ? "✓ " : (testResult.site_reachable as boolean) ? "ℹ️ " : "⚠ "}
                {String(testResult.recommendation ?? "")}
              </p>
              {Boolean(testResult.platform) && (
                <p className="mt-1 text-slate-400 text-xs">Platform detected: <strong>{String(testResult.platform)}</strong> {testResult.detected_version ? `v${String(testResult.detected_version)}` : ""}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                <span className={(testResult.site_reachable as boolean) ? "text-emerald-400" : "text-red-400"}>
                  {(testResult.site_reachable as boolean) ? "✓" : "✗"} Site Reachable
                </span>
                <span className={(testResult.webhook_found as boolean) ? "text-emerald-400" : "text-slate-500"}>
                  {(testResult.webhook_found as boolean) ? "✓" : "○"} Webhook Endpoint
                </span>
                <span className={(testResult.health_endpoint as boolean) ? "text-emerald-400" : "text-slate-500"}>
                  {(testResult.health_endpoint as boolean) ? "✓" : "○"} Health Endpoint
                </span>
                <span>Score: <strong>{String(testResult.health_score ?? 0)}/100</strong></span>
              </div>
              {Array.isArray(testResult.endpoints_found) && (testResult.endpoints_found as string[]).length > 0 && (
                <p className="mt-1 text-slate-500 text-xs">Found: {(testResult.endpoints_found as string[]).join(", ")}</p>
              )}
            </div>
          )}
          <button
            onClick={() => setStep(2)} disabled={!form.website_name || !form.website_url}
            className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
          >
            Continue <ChevronRight className="inline h-4 w-4" />
          </button>
        </div>
      )}

      {/* Step 2: API Key */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-300">
            <Info className="mb-1 inline h-4 w-4" /> Enter the API key your website uses to authenticate requests to WACRM. Leave blank to auto-generate one.
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Website API Key</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500"
              placeholder="Leave blank to auto-generate" value={form.website_api_key}
              onChange={e => set("website_api_key", e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">This is the key GilafStore sends in the X-GilafStore-Key header.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Webhook URL (where WACRM sends events)</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500"
              placeholder="https://yourstore.com/api/wacrm-webhook" value={form.webhook_url}
              onChange={e => set("webhook_url", e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-400 hover:bg-slate-800">← Back</button>
            <button onClick={() => setStep(3)} className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">
              Continue <ChevronRight className="inline h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Webhook Events */}
      {step === 3 && (
        <div className="space-y-5">
          <p className="text-sm text-slate-400">Choose which events WACRM should send to your website:</p>
          <div className="grid grid-cols-2 gap-2">
            {ALL_EVENTS.map(ev => (
              <button
                key={ev}
                onClick={() => toggleEvent(ev)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  form.webhook_events.includes(ev)
                    ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                    : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
                }`}
              >
                <div className={`h-2 w-2 rounded-full ${form.webhook_events.includes(ev) ? "bg-violet-400" : "bg-slate-600"}`} />
                {ev}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-400 hover:bg-slate-800">← Back</button>
            <button onClick={() => setStep(4)} className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">
              Review <ChevronRight className="inline h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3 text-sm">
            <Row label="Website"  value={form.website_name} />
            <Row label="URL"      value={form.website_url} />
            <Row label="Platform" value={PLATFORMS.find(p => p.value === form.platform)?.label ?? form.platform} />
            <Row label="API Key"  value={form.website_api_key || "(auto-generate)"} mono />
            <Row label="Webhook URL" value={form.webhook_url || "(not set)"} mono />
            <Row label="Events"   value={`${form.webhook_events.length} selected`} />
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            ⚠ After saving, your API secret and webhook secret will be shown <strong>once</strong>. Copy and save them immediately.
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(3)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-400 hover:bg-slate-800">← Back</button>
            <button
              onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Saving…" : "Save Integration"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`text-right text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

// ─── Integration Detail View ──────────────────────────────────────────────────

function IntegrationDetail({
  intg, onBack, onRefresh,
}: {
  intg: Integration;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "webhooks" | "sync" | "settings">("overview");
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const s = STATUS_CONFIG[intg.status] ?? STATUS_CONFIG.pending;

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await fetch("/api/integrations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: intg.id, website_url: intg.website_url, website_api_key: intg.website_api_key }),
    });
    const data = await r.json();
    setTestResult(data);
    setTesting(false);
    onRefresh();
  };

  const syncNow = async () => {
    setSyncing(true);
    await fetch("/api/integrations/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: intg.id, entity_type: "all" }),
    });
    setSyncing(false);
    onRefresh();
  };

  const loadDeliveries = useCallback(async () => {
    setLoadingDeliveries(true);
    const r = await fetch(`/api/integrations/sync?integration_id=${intg.id}`);
    const data = await r.json();
    setDeliveries(data.deliveries ?? []);
    setLoadingDeliveries(false);
  }, [intg.id]);

  useEffect(() => { if (tab === "webhooks") loadDeliveries(); }, [tab, loadDeliveries]);

  const retryWebhook = async (deliveryId: string) => {
    await fetch("/api/integrations/sync?action=retry-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delivery_id: deliveryId }),
    });
    loadDeliveries();
  };

  const updateSetting = async (updates: Record<string, unknown>) => {
    await fetch("/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: intg.id, ...updates }),
    });
    onRefresh();
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <button onClick={onBack} className="mt-0.5 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
          ←
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-white">{intg.website_name}</h2>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.color}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            <a href={intg.website_url} target="_blank" rel="noreferrer" className="hover:text-slate-300 flex items-center gap-1 inline-flex">
              {intg.website_url} <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={testConnection} disabled={testing} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            Test
          </button>
          <button onClick={syncNow} disabled={syncing} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Now
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${
          (testResult.connected as boolean) ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        }`}>
          <p className="font-medium">{(testResult.connected as boolean) ? "✓ Connected" : "⚠ Connection Issue"}</p>
          <p className="mt-0.5 text-xs opacity-80">{String(testResult.recommendation ?? "")}</p>
          <div className="mt-2 flex gap-4 text-xs">
            <span>Health: <strong>{String(testResult.health_score ?? 0)}/100</strong></span>
            <span>Platform: <strong>{String(testResult.platform ?? "Unknown")}</strong></span>
            <span>Endpoints found: <strong>{(testResult.endpoints_found as string[])?.length ?? 0}</strong></span>
          </div>
        </div>
      )}

      {/* Health Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Activity className="h-4 w-4" />} label="Health Score" value={`${intg.health_score}/100`} sub="" color="violet" />
        <StatCard icon={<Webhook className="h-4 w-4" />} label="Webhooks Sent" value={String(intg.total_webhooks_sent)} sub={`${intg.total_webhooks_failed} failed`} color={intg.total_webhooks_failed > 0 ? "red" : "emerald"} />
        <StatCard icon={<RefreshCw className="h-4 w-4" />} label="Last Sync" value={timeAgo(intg.last_sync_at)} sub={`${intg.total_synced_contacts} contacts`} color="blue" />
        <StatCard icon={<Wifi className="h-4 w-4" />} label="Heartbeat" value={intg.heartbeat_latency_ms ? `${intg.heartbeat_latency_ms}ms` : "—"} sub={timeAgo(intg.last_heartbeat_at)} color="emerald" />
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
        {(["overview", "webhooks", "sync", "settings"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium capitalize transition-colors ${
              tab === t ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >{t}</button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="space-y-4">
          <InfoGrid rows={[
            { label: "API Key", value: intg.website_api_key, copy: true },
            { label: "Platform", value: intg.platform },
            { label: "Detected Version", value: intg.discovered_version ?? "—" },
            { label: "Created", value: new Date(intg.created_at).toLocaleDateString("en-IN") },
          ]} />
          {intg.last_error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              <strong>Last Error:</strong> {intg.last_error}
            </div>
          )}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Health Score</label>
            <HealthBar score={intg.health_score} />
          </div>
        </div>
      )}

      {/* Webhooks Tab */}
      {tab === "webhooks" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Webhook Deliveries</h3>
            <button onClick={loadDeliveries} className="text-xs text-slate-400 hover:text-white">
              <RefreshCw className="inline h-3.5 w-3.5 mr-1" />Refresh
            </button>
          </div>
          {loadingDeliveries ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
          ) : deliveries.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">No webhook deliveries yet.</div>
          ) : (
            <div className="space-y-2">
              {deliveries.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3">
                  <div className={`h-2 w-2 shrink-0 rounded-full ${
                    d.status === "delivered" ? "bg-emerald-400" : d.status === "failed" ? "bg-red-400" : "bg-amber-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200">{d.event_type}</p>
                    <p className="text-xs text-slate-500">
                      HTTP {d.http_status || "—"} · {d.duration_ms}ms · Attempt {d.attempt} · {timeAgo(d.created_at)}
                    </p>
                    {d.error_message && <p className="text-xs text-red-400 mt-0.5 truncate">{d.error_message}</p>}
                  </div>
                  {d.status === "failed" && (
                    <button onClick={() => retryWebhook(d.id)} className="shrink-0 rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">
                      <RotateCcw className="inline h-3 w-3 mr-0.5" />Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sync Tab */}
      {tab === "sync" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-200">Auto Sync</p>
              <p className="text-xs text-slate-500">Automatically sync contacts from your website</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={intg.auto_sync_enabled}
                onChange={e => updateSetting({ auto_sync_enabled: e.target.checked })}
                className="peer sr-only" />
              <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-violet-600 peer-checked:after:translate-x-full" />
            </label>
          </div>
          {intg.auto_sync_enabled && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">Sync Interval</label>
              <div className="grid grid-cols-6 gap-2">
                {[
                  { val: 5, label: '5s' },
                  { val: 10, label: '10s' },
                  { val: 15, label: '15s' },
                  { val: 30, label: '30s' },
                  { val: 45, label: '45s' },
                  { val: 60, label: '1m' },
                ].map(opt => (
                  <button key={opt.val}
                    onClick={() => updateSetting({ sync_interval_min: opt.val })}
                    className={`rounded-lg border py-2 text-sm transition-colors ${
                      intg.sync_interval_min === opt.val
                        ? "border-violet-500 bg-violet-500/20 text-violet-300"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"
                    }`}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-300">Manual Sync</p>
            <div className="grid grid-cols-3 gap-2">
              {["contacts", "orders", "all"].map(t => (
                <button key={t} onClick={async () => {
                  setSyncing(true);
                  await fetch("/api/integrations/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: intg.id, entity_type: t }),
                  });
                  setSyncing(false);
                  onRefresh();
                }} disabled={syncing}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 capitalize hover:bg-slate-800 disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {tab === "settings" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-200">Heartbeat / Keep Alive</p>
              <p className="text-xs text-slate-500">Ping every 5 min to prevent Render sleep</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={intg.heartbeat_enabled}
                onChange={e => updateSetting({ heartbeat_enabled: e.target.checked })}
                className="peer sr-only" />
              <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-violet-600 peer-checked:after:translate-x-full" />
            </label>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Webhook URL</label>
            <div className="flex gap-2">
              <input defaultValue={intg.webhook_url ?? ""} onBlur={e => updateSetting({ webhook_url: e.target.value })}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white outline-none focus:border-violet-500"
                placeholder="https://yourstore.com/api/wacrm-webhook"
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-300">Webhook Secret (masked)</p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-400">
              <Shield className="h-3.5 w-3.5 text-violet-400" />
              {showSecret ? "Stored securely. Regenerate if compromised." : "••••••••••••••••••••••••"}
              <button onClick={() => setShowSecret(v => !v)} className="ml-auto">
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800">
            <p className="mb-1 text-xs text-slate-500">Danger Zone</p>
            <button onClick={async () => {
              if (!confirm(`Delete integration "${intg.website_name}"? This cannot be undone.`)) return;
              await fetch(`/api/integrations?id=${intg.id}`, { method: "DELETE" });
              onBack(); onRefresh();
            }} className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20">
              <Trash2 className="h-4 w-4" /> Delete Integration
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: ReactNode; label: string; value: string; sub: string; color: string;
}) {
  const colors: Record<string, string> = {
    violet: "text-violet-400", emerald: "text-emerald-400",
    blue: "text-blue-400", red: "text-red-400",
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className={`mb-2 ${colors[color] ?? "text-slate-400"}`}>{icon}</div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      {sub && <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function InfoGrid({ rows }: { rows: Array<{ label: string; value: string; copy?: boolean }> }) {
  return (
    <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 overflow-hidden">
      {rows.map(row => (
        <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-900/40">
          <span className="text-xs text-slate-500 shrink-0">{row.label}</span>
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-mono text-xs text-slate-300">{row.value}</span>
            {row.copy && row.value !== "—" && (
              <button onClick={() => copyText(row.value)} className="shrink-0 text-slate-600 hover:text-slate-300">
                <Copy className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [view, setView] = useState<View>("list");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Integration | null>(null);
  const [newCredentials, setNewCredentials] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/integrations");
    const data = await r.json();
    setIntegrations(data.integrations ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (data: Record<string, unknown>) => {
    setNewCredentials(data);
    load();
  };

  const openDetail = (intg: Integration) => {
    setSelected(intg);
    setView("detail");
  };

  const refreshDetail = async () => {
    await load();
    if (selected) {
      const r = await fetch("/api/integrations");
      const data = await r.json();
      const updated = (data.integrations ?? []).find((i: Integration) => i.id === selected.id);
      if (updated) setSelected(updated);
    }
  };

  // ── One-time credentials modal ─────────────────────────────────────────────
  if (newCredentials) {
    return (
      <div className="min-h-screen bg-slate-950 p-6">
        <div className="mx-auto max-w-xl">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
            <div className="mb-4 flex items-center gap-3">
              <Shield className="h-6 w-6 text-amber-400" />
              <h2 className="text-lg font-bold text-amber-300">Save Your Credentials — Shown Once!</h2>
            </div>
            <p className="mb-6 text-sm text-amber-200/70">These secrets will never be shown again. Copy them now and store securely.</p>
            <div className="space-y-3">
              {[
                { label: "Connection Token", key: "connection_token" },
                { label: "Website Secret", key: "website_secret" },
                { label: "Webhook Secret", key: "webhook_secret" },
              ].map(({ label, key }) => (
                <div key={key}>
                  <p className="mb-1 text-xs text-slate-400">{label}</p>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                    <code className="flex-1 break-all font-mono text-xs text-emerald-300">{String(newCredentials[key] ?? "")}</code>
                    <button onClick={() => copyText(String(newCredentials[key] ?? ""))} className="shrink-0 text-slate-500 hover:text-white">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400">
              <strong className="text-slate-300">GilafStore Setup:</strong> Go to your GilafStore Admin → WhatsApp CRM Integration → paste the Connection Token only. The system will auto-configure everything.
            </div>
            <button onClick={() => { setNewCredentials(null); setView("list"); }}
              className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
              ✓ I&apos;ve saved my credentials — Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-5xl p-6">

        {/* Page Header */}
        {view !== "detail" && (
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20">
                <Globe className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Website Integration</h1>
                <p className="text-sm text-slate-500">Connect any website to WACRM in under 60 seconds</p>
              </div>
            </div>
            {view === "list" && (
              <button onClick={() => setView("add")}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500">
                <Plus className="h-4 w-4" /> Add Website
              </button>
            )}
            {view === "add" && (
              <button onClick={() => setView("list")} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">
                ← Cancel
              </button>
            )}
          </div>
        )}

        {/* List View */}
        {view === "list" && (
          <>
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>
            ) : integrations.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900">
                  <Globe className="h-8 w-8 text-slate-600" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">No integrations yet</h3>
                <p className="mb-6 max-w-sm text-sm text-slate-500">
                  Connect your WooCommerce, Shopify, or any custom website to WACRM. Takes under 60 seconds.
                </p>
                <button onClick={() => setView("add")}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">
                  <Plus className="h-4 w-4" /> Connect First Website
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {integrations.map(intg => {
                  const s = STATUS_CONFIG[intg.status] ?? STATUS_CONFIG.pending;
                  return (
                    <button key={intg.id} onClick={() => openDetail(intg)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-left transition-colors hover:border-slate-700 hover:bg-slate-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600/20">
                          <Globe className="h-5 w-5 text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-white">{intg.website_name}</h3>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.bg} ${s.color}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                              {s.label}
                            </span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 capitalize">{intg.platform}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{intg.website_url}</p>
                          <div className="mt-3">
                            <HealthBar score={intg.health_score} />
                          </div>
                        </div>
                        <div className="shrink-0 text-right hidden sm:block">
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <p className="text-sm font-bold text-white">{intg.total_synced_contacts}</p>
                              <p className="text-[10px] text-slate-500">Contacts</p>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">{intg.total_webhooks_sent}</p>
                              <p className="text-[10px] text-slate-500">Webhooks</p>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-400">{timeAgo(intg.last_sync_at)}</p>
                              <p className="text-[10px] text-slate-500">Last Sync</p>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 self-center" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* How it works */}
            {integrations.length === 0 && (
              <div className="mt-12 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-300">How it works</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  {[
                    { step: "1", icon: <Globe className="h-4 w-4" />, title: "Enter Website URL", desc: "Your store URL — WooCommerce, Shopify, or custom" },
                    { step: "2", icon: <Shield className="h-4 w-4" />, title: "Enter API Key", desc: "The key your website uses to call WACRM" },
                    { step: "3", icon: <Zap className="h-4 w-4" />, title: "Click Save", desc: "WACRM auto-configures webhooks and secrets" },
                    { step: "4", icon: <CheckCircle2 className="h-4 w-4" />, title: "Live in 60s", desc: "Events, sync, and OTP flow automatically" },
                  ].map(item => (
                    <div key={item.step} className="flex flex-col items-center text-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600/20 text-violet-400">
                        {item.icon}
                      </div>
                      <p className="text-xs font-semibold text-slate-300">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Add Integration View */}
        {view === "add" && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
            <h2 className="mb-6 text-lg font-bold text-white">Connect a Website</h2>
            <AddIntegrationForm onCreated={handleCreated} />
          </div>
        )}

        {/* Detail View */}
        {view === "detail" && selected && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <IntegrationDetail
              intg={selected}
              onBack={() => { setView("list"); setSelected(null); }}
              onRefresh={refreshDetail}
            />
          </div>
        )}
      </div>
    </div>
  );
}
