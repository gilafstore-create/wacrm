"use client";

import { useState, useEffect, useCallback, type ReactNode, useRef } from "react";
import {
  Globe, Plus, CheckCircle2, XCircle, RefreshCw, Zap, Webhook, Clock,
  Shield, Eye, EyeOff, Copy, ChevronRight, Trash2, Activity, Wifi,
  Search, RotateCcw, Play, Loader2, Info, ExternalLink, Key, Lock,
  AlertTriangle, TrendingUp, Database, Server, BarChart2, Bell,
  Settings, ArrowRight, ChevronDown, ChevronUp, Terminal, Download,
  Filter, Check, X, MoreVertical, Sparkles, Layers, Network,
  Radio, Telescope, ChevronLeft, AlertCircle, Box, Hash,
} from "lucide-react";

// ─── Constants ─────────────────────────────────────────────────────────────────

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

// ─── Type Definitions ──────────────────────────────────────────────────────────

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
  next_sync_at: string | null;
  last_sync_attempt_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_duration_ms: number | null;
  consecutive_sync_failures: number;
}

interface ApiKey {
  id: string;
  key_name: string;
  key_prefix: string;
  key_type: string;
  expires_at: string | null;
  status: "active" | "disabled" | "revoked" | "expired";
  created_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  usage_count: number;
  scope: string[];
  description: string | null;
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  full_key?: string; // Only available on creation
}

interface SecurityScore {
  overall_score: number;
  ssl_score: number;
  api_key_security_score: number;
  webhook_validation_score: number;
  secret_rotation_score: number;
  failed_requests_score: number;
  suspicious_ips_score: number;
  rate_limit_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_factors: { type: string; count: number }[];
  recommendations: string[];
}

interface LiveCounters {
  requests_today: number;
  contacts_synced: number;
  orders_synced: number;
  failed_syncs: number;
  queue_size: number;
  webhook_events: number;
  timestamp: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts: string | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function copyToClipboard(text: string, onSuccess?: () => void) {
  navigator.clipboard.writeText(text).then(() => onSuccess?.());
}

const KEY_TYPE_LABELS: Record<string, string> = {
  never_expire: "Never Expires",
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
  "90d": "90 Days",
  "1y": "1 Year",
  custom: "Custom",
};

// ─── Premium UI Primitives ───────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/5 bg-slate-900/60 backdrop-blur-sm shadow-xl ${className}`}>
      {children}
    </div>
  );
}

function ScoreBadge({ score, max, size = "sm" }: { score: number; max: number; size?: "sm" | "lg" }) {
  const pct = Math.min((score / max) * 100, 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  const ring = pct >= 80 ? "ring-emerald-500/40" : pct >= 60 ? "ring-amber-500/40" : "ring-red-500/40";
  if (size === "lg") {
    return (
      <div className={`flex flex-col items-center justify-center rounded-full w-24 h-24 ring-4 ${ring} bg-slate-800`}>
        <span className={`text-2xl font-bold ${color}`}>{score}</span>
        <span className="text-xs text-slate-500">/ {max}</span>
      </div>
    );
  }
  return (
    <span className={`text-sm font-semibold ${color}`}>{score}/{max}</span>
  );
}

function MiniBar({ value, max, color = "bg-violet-500" }: { value: number; max: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-700/60">
      <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    warning: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    error: "bg-red-500/15 text-red-400 border border-red-500/20",
    pending: "bg-slate-500/15 text-slate-400 border border-slate-500/20",
    disabled: "bg-slate-600/15 text-slate-500 border border-slate-600/20",
    revoked: "bg-red-500/15 text-red-400 border border-red-500/20",
    expired: "bg-orange-500/15 text-orange-400 border border-orange-500/20",
    low: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    medium: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    high: "bg-red-500/15 text-red-400 border border-red-500/20",
    critical: "bg-red-600/20 text-red-300 border border-red-600/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] || map.pending}`}>
      {status}
    </span>
  );
}

function SectionHeader({ icon, title, subtitle, action }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function MetricCard({ icon, label, value, sub, trend, color = "violet" }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "flat";
  color?: "violet" | "emerald" | "blue" | "amber" | "red";
}) {
  const colors: Record<string, string> = {
    violet: "text-violet-400 bg-violet-500/10",
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    red: "text-red-400 bg-red-500/10",
  };
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm ${colors[color]}`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-xs ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-slate-500"}`}>
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="text-xl font-bold text-slate-100">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
      </div>
    </GlassCard>
  );
}

// ─── API Key Management ──────────────────────────────────────────────────────

function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    key_name: "",
    key_type: "never_expire",
    description: "",
    scope: ["read", "write"],
    rate_limit_per_minute: 60,
    ip_whitelist: "",
    domain_whitelist: "",
  });

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/api-keys");
    const d = await r.json();
    setKeys(d.keys || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const createKey = async () => {
    if (!form.key_name.trim()) return;
    setCreating(true);
    const r = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        ip_whitelist: form.ip_whitelist ? form.ip_whitelist.split(",").map(s => s.trim()) : undefined,
        domain_whitelist: form.domain_whitelist ? form.domain_whitelist.split(",").map(s => s.trim()) : undefined,
      }),
    });
    const d = await r.json();
    if (r.ok) {
      setNewKey(d);
      setShowCreate(false);
      loadKeys();
    }
    setCreating(false);
  };

  const revokeKey = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    await fetch(`/api/api-keys/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Manually revoked" }) });
    loadKeys();
  };

  const disableKey = async (id: string, disabled: boolean) => {
    await fetch(`/api/api-keys/${id}/${disabled ? "enable" : "disable"}`, { method: "POST" });
    loadKeys();
  };

  const rotateKey = async (id: string) => {
    if (!confirm("Rotate this API key? The old key will stop working immediately.")) return;
    const r = await fetch(`/api/api-keys/${id}/rotate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Manual rotation" }) });
    const d = await r.json();
    if (r.ok) setNewKey(d);
    loadKeys();
  };

  const handleCopy = (text: string, id: string) => {
    copyToClipboard(text, () => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  };

  return (
    <div>
      <SectionHeader
        icon={<Key className="h-4 w-4" />}
        title="API Key Management"
        subtitle="Manage authentication keys with enterprise-grade security"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 transition-colors"
          >
            <Plus className="h-3 w-3" /> New Key
          </button>
        }
      />

      {/* New Key Created Modal */}
      {newKey?.full_key && (
        <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-400">API Key Created — Copy Now!</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">This is the only time you'll see the full key. Store it securely.</p>
          <div className="flex items-center gap-2 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2">
            <code className="flex-1 text-xs text-violet-300 font-mono break-all">{newKey.full_key}</code>
            <button onClick={() => handleCopy(newKey.full_key!, "new")} className="text-slate-400 hover:text-white transition-colors">
              {copiedId === "new" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-3 text-xs text-slate-500 hover:text-slate-300">
            Dismiss (make sure you copied it!)
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <GlassCard className="mb-5 p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Create New API Key</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Key Name *</label>
              <input
                value={form.key_name}
                onChange={e => setForm(f => ({ ...f, key_name: e.target.value }))}
                placeholder="e.g. Production Key"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Expiry Type</label>
              <select
                value={form.key_type}
                onChange={e => setForm(f => ({ ...f, key_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                {Object.entries(KEY_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Rate Limit (req/min)</label>
              <input
                type="number"
                value={form.rate_limit_per_minute}
                onChange={e => setForm(f => ({ ...f, rate_limit_per_minute: parseInt(e.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">IP Whitelist (comma separated)</label>
              <input
                value={form.ip_whitelist}
                onChange={e => setForm(f => ({ ...f, ip_whitelist: e.target.value }))}
                placeholder="e.g. 192.168.1.1, 10.0.0.0"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-400 block mb-1.5">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <button
              onClick={createKey}
              disabled={creating || !form.key_name.trim()}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Create Key
            </button>
          </div>
        </GlassCard>
      )}

      {/* Keys Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading keys…</div>
      ) : keys.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <Key className="mx-auto h-8 w-8 text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No API keys yet.</p>
          <button onClick={() => setShowCreate(true)} className="mt-3 text-xs text-violet-400 hover:text-violet-300">Create your first key →</button>
        </GlassCard>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr>
                {["Key Name", "Type / Expiry", "Status", "Last Used", "Usage", "Actions"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-900/40">
              {keys.map(key => (
                <tr key={key.id} className="hover:bg-slate-800/30 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-200">{key.key_name}</div>
                    <div className="text-xs font-mono text-slate-500 mt-0.5">{key.key_prefix}•••</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-300 text-xs">{KEY_TYPE_LABELS[key.key_type] || key.key_type}</div>
                    {key.expires_at && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        Expires {new Date(key.expires_at).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={key.status} /></td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-400">{timeAgo(key.last_used_at)}</div>
                    {key.last_used_ip && <div className="text-xs text-slate-600 font-mono">{key.last_used_ip}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-400">{key.usage_count.toLocaleString()} requests</div>
                    <div className="text-xs text-slate-600">{key.rate_limit_per_minute} req/min</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopy(key.key_prefix + "•••", key.id)}
                        title="Copy prefix"
                        className="rounded p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      >
                        {copiedId === key.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => rotateKey(key.id)}
                        title="Rotate key"
                        className="rounded p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => disableKey(key.id, key.status === "disabled")}
                        title={key.status === "disabled" ? "Enable key" : "Disable key"}
                        className="rounded p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      >
                        {key.status === "disabled" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => revokeKey(key.id)}
                        title="Revoke key"
                        className="rounded p-1.5 hover:bg-red-900/30 text-slate-400 hover:text-red-400 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Security Center ─────────────────────────────────────────────────────────

function SecurityCenter() {
  const [score, setScore] = useState<SecurityScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadScore = useCallback(async () => {
    setRefreshing(true);
    const r = await fetch("/api/security/score");
    if (r.ok) {
      const d = await r.json();
      setScore(d);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadScore(); }, [loadScore]);

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Calculating security score…</div>;

  const breakdown = score ? [
    { label: "SSL / TLS", score: score.ssl_score, max: 20 },
    { label: "API Key Security", score: score.api_key_security_score, max: 20 },
    { label: "Webhook Validation", score: score.webhook_validation_score, max: 20 },
    { label: "Secret Rotation", score: score.secret_rotation_score, max: 10 },
    { label: "Failed Requests", score: score.failed_requests_score, max: 10 },
    { label: "Suspicious IPs", score: score.suspicious_ips_score, max: 10 },
    { label: "Rate Limits", score: score.rate_limit_score, max: 10 },
  ] : [];

  const riskColors: Record<string, string> = {
    low: "text-emerald-400",
    medium: "text-amber-400",
    high: "text-red-400",
    critical: "text-red-300",
  };

  return (
    <div>
      <SectionHeader
        icon={<Shield className="h-4 w-4" />}
        title="Security Center"
        subtitle="Real-time security analysis and threat detection"
        action={
          <button onClick={loadScore} disabled={refreshing} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Recalculate
          </button>
        }
      />

      {score && (
        <div className="grid grid-cols-3 gap-5">
          {/* Main Score */}
          <GlassCard className="col-span-1 p-5 flex flex-col items-center justify-center gap-3 text-center">
            <ScoreBadge score={score.overall_score} max={100} size="lg" />
            <div>
              <div className={`text-sm font-semibold uppercase tracking-wider ${riskColors[score.risk_level]}`}>
                {score.risk_level} Risk
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Security Score</div>
            </div>
          </GlassCard>

          {/* Breakdown */}
          <GlassCard className="col-span-2 p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Breakdown</h3>
            <div className="space-y-3">
              {breakdown.map(b => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="w-36 text-xs text-slate-400 shrink-0">{b.label}</span>
                  <MiniBar
                    value={b.score}
                    max={b.max}
                    color={b.score / b.max >= 0.8 ? "bg-emerald-500" : b.score / b.max >= 0.5 ? "bg-amber-500" : "bg-red-500"}
                  />
                  <span className="w-12 text-right text-xs font-mono text-slate-400">{b.score}/{b.max}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Recommendations */}
          {score.recommendations && score.recommendations.length > 0 && (
            <GlassCard className="col-span-3 p-5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Recommendations</h3>
              <div className="space-y-2">
                {score.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-xs text-slate-300">{rec}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Health Center ───────────────────────────────────────────────────────────

function HealthCenter({ integration }: { integration: Integration }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const runTest = async () => {
    setTesting(true);
    const r = await fetch("/api/integrations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: integration.id, website_url: integration.website_url, website_api_key: integration.website_api_key }),
    });
    const d = await r.json();
    setResult(d);
    setTesting(false);
  };

  const breakdown = result?.health_breakdown as Record<string, { score: number; max: number; checks: Record<string, unknown> }> || null;

  const categories: { key: string; label: string; icon: ReactNode; color: string }[] = breakdown ? [
    { key: "connectivity", label: "Connectivity", icon: <Wifi className="h-3.5 w-3.5" />, color: "bg-blue-500" },
    { key: "integration", label: "Integration", icon: <Network className="h-3.5 w-3.5" />, color: "bg-violet-500" },
    { key: "sync_health", label: "Sync Health", icon: <RefreshCw className="h-3.5 w-3.5" />, color: "bg-emerald-500" },
    { key: "data_health", label: "Data Health", icon: <Database className="h-3.5 w-3.5" />, color: "bg-cyan-500" },
    { key: "activity_health", label: "Activity Health", icon: <Activity className="h-3.5 w-3.5" />, color: "bg-amber-500" },
  ] : [];

  const totalScore = result?.health_score as number ?? integration.health_score;

  return (
    <div>
      <SectionHeader
        icon={<Activity className="h-4 w-4" />}
        title="Health Center"
        subtitle="Multi-dimensional integration health analysis"
        action={
          <button
            onClick={runTest}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Run Health Check
          </button>
        }
      />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <GlassCard className="p-5 flex flex-col items-center justify-center gap-2 col-span-1">
          <ScoreBadge score={totalScore} max={100} size="lg" />
          <div className="text-xs text-slate-500 text-center">Overall Health</div>
          <StatusPill status={integration.status} />
        </GlassCard>
        <div className="col-span-3 grid grid-cols-2 gap-3">
          {breakdown ? categories.map(c => {
            const cat = breakdown[c.key];
            return (
              <GlassCard key={c.key} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-slate-400">{c.icon}<span className="text-xs">{c.label}</span></div>
                  <span className="text-xs font-semibold text-slate-300">{cat.score}/{cat.max}</span>
                </div>
                <MiniBar value={cat.score} max={cat.max} color={cat.score / cat.max >= 0.8 ? "bg-emerald-500" : cat.score / cat.max >= 0.5 ? "bg-amber-500" : "bg-red-500"} />
              </GlassCard>
            );
          }) : (
            <div className="col-span-2 flex items-center justify-center">
              <p className="text-xs text-slate-500">Click "Run Health Check" to see detailed breakdown.</p>
            </div>
          )}
        </div>
      </div>

      {Boolean(result?.recommendation) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${result?.connected ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-amber-500/30 bg-amber-500/5 text-amber-300"}`}>
          {String(result?.recommendation ?? "")}
        </div>
      )}
    </div>
  );
}

// ─── Real-time Monitoring ────────────────────────────────────────────────────

function RealtimeMonitor() {
  const [counters, setCounters] = useState<LiveCounters | null>(null);
  const [interval, setRefreshInterval] = useState(10);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch("/api/monitoring/counters");
    if (r.ok) setCounters(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, interval * 1000);
    return () => clearInterval(t);
  }, [load, interval]);

  return (
    <div>
      <SectionHeader
        icon={<Activity className="h-4 w-4" />}
        title="Real-time Monitoring"
        subtitle="Live system counters with auto-refresh"
        action={
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Refresh:</span>
            {[5, 10, 30, 60].map(s => (
              <button
                key={s}
                onClick={() => setRefreshInterval(s)}
                className={`rounded px-2 py-1 text-xs transition-colors ${interval === s ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white hover:bg-slate-700"}`}
              >
                {s}s
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading counters…</div>
      ) : counters && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <MetricCard icon={<Zap className="h-4 w-4" />} label="Requests Today" value={counters.requests_today.toLocaleString()} color="violet" />
          <MetricCard icon={<Globe className="h-4 w-4" />} label="Contacts Synced" value={counters.contacts_synced.toLocaleString()} color="blue" />
          <MetricCard icon={<BarChart2 className="h-4 w-4" />} label="Orders Synced" value={counters.orders_synced.toLocaleString()} color="emerald" />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="Failed Syncs" value={counters.failed_syncs.toLocaleString()} color={counters.failed_syncs > 0 ? "red" : "emerald"} />
          <MetricCard icon={<Layers className="h-4 w-4" />} label="Queue Size" value={counters.queue_size.toLocaleString()} color={counters.queue_size > 10 ? "amber" : "emerald"} />
          <MetricCard icon={<Webhook className="h-4 w-4" />} label="Webhook Events" value={counters.webhook_events.toLocaleString()} color="violet" />
        </div>
      )}

      {counters && (
        <p className="mt-3 text-right text-xs text-slate-600">
          Last updated: {new Date(counters.timestamp).toLocaleTimeString()} · Auto-refresh every {interval}s
        </p>
      )}
    </div>
  );
}

// ─── Sync Center ─────────────────────────────────────────────────────────────

function SyncCenter({ integration, onRefresh }: { integration: Integration; onRefresh: () => void }) {
  const [syncing, setSyncing] = useState<string | null>(null);

  const sync = async (type: string) => {
    setSyncing(type);
    await fetch("/api/integrations/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: integration.id, entity_type: type }),
    });
    setSyncing(null);
    onRefresh();
  };

  const syncTypes = [
    { type: "contacts", label: "Sync Contacts", icon: <Globe className="h-4 w-4" /> },
    { type: "orders", label: "Sync Orders", icon: <BarChart2 className="h-4 w-4" /> },
    { type: "products", label: "Sync Products", icon: <Layers className="h-4 w-4" /> },
    { type: "all", label: "Full Sync", icon: <RefreshCw className="h-4 w-4" />, accent: true },
  ];

  return (
    <div>
      <SectionHeader
        icon={<RefreshCw className="h-4 w-4" />}
        title="Sync Center"
        subtitle="Manual sync controls and sync health metrics"
      />

      <div className="grid grid-cols-2 gap-4 mb-5">
        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Sync Status</h3>
          <div className="space-y-2">
            {[
              { label: "Last Sync", value: timeAgo(integration.last_sync_at) },
              { label: "Next Sync", value: timeAgo(integration.next_sync_at) },
              { label: "Status", value: <StatusPill status={integration.last_sync_status || "pending"} /> },
              { label: "Duration", value: integration.last_sync_duration_ms ? `${integration.last_sync_duration_ms}ms` : "—" },
              { label: "Contacts", value: (integration.total_synced_contacts || 0).toLocaleString() },
              { label: "Orders", value: (integration.total_synced_orders || 0).toLocaleString() },
              { label: "Failures", value: integration.consecutive_sync_failures || 0, color: integration.consecutive_sync_failures > 0 ? "text-red-400" : "text-slate-300" },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{row.label}</span>
                <span className={`font-medium ${(row as { color?: string }).color || "text-slate-300"}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Manual Sync</h3>
          <div className="grid grid-cols-2 gap-2">
            {syncTypes.map(s => (
              <button
                key={s.type}
                onClick={() => sync(s.type)}
                disabled={!!syncing}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-medium transition-colors disabled:opacity-40 ${
                  s.accent
                    ? "bg-violet-600 text-white hover:bg-violet-500"
                    : "border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {syncing === s.type ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.icon}
                {s.label}
              </button>
            ))}
          </div>
          {integration.last_sync_error && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
              <p className="text-xs text-red-400 font-medium mb-1">Last Error</p>
              <p className="text-xs text-slate-400 font-mono">{integration.last_sync_error}</p>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Webhook Center ──────────────────────────────────────────────────────────

function WebhookCenter({ integration }: { integration: Integration }) {
  const [deliveries, setDeliveries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/integrations/sync?integration_id=${integration.id}`);
    if (r.ok) {
      const d = await r.json();
      setDeliveries(d.deliveries || []);
    }
    setLoading(false);
  }, [integration.id]);

  useEffect(() => { load(); }, [load]);

  const successRate = deliveries.length > 0
    ? Math.round((deliveries.filter(d => d.status === "delivered").length / deliveries.length) * 100)
    : 0;

  return (
    <div>
      <SectionHeader
        icon={<Webhook className="h-4 w-4" />}
        title="Webhook Center"
        subtitle="Webhook delivery monitoring and management"
        action={
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard icon={<Webhook className="h-4 w-4" />} label="Total Sent" value={integration.total_webhooks_sent} color="violet" />
        <MetricCard icon={<XCircle className="h-4 w-4" />} label="Failed" value={integration.total_webhooks_failed} color={integration.total_webhooks_failed > 0 ? "red" : "emerald"} />
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Success Rate" value={`${successRate}%`} color={successRate >= 95 ? "emerald" : successRate >= 80 ? "amber" : "red"} />
        <MetricCard icon={<Clock className="h-4 w-4" />} label="Last Delivery" value={timeAgo(integration.last_sync_at)} color="blue" />
      </div>

      {integration.webhook_url && (
        <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-400">Webhook URL</span>
              <div className="text-xs text-slate-300 font-mono mt-0.5">{integration.webhook_url}</div>
            </div>
            <StatusPill status={integration.webhook_url ? "active" : "disabled"} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading delivery logs…</div>
      ) : deliveries.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No deliveries yet.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60">
              <tr>
                {["Event", "Status", "HTTP", "Duration", "Timestamp"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-900/40">
              {deliveries.slice(0, 20).map((d: Record<string, unknown>) => (
                <tr key={d.id as string} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-slate-300">{d.event_type as string}</td>
                  <td className="px-4 py-2.5"><StatusPill status={d.status as string} /></td>
                  <td className="px-4 py-2.5">
                    <span className={`font-mono ${(d.http_status as number) >= 400 ? "text-red-400" : "text-emerald-400"}`}>
                      {d.http_status as number || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{d.duration_ms as number ? `${d.duration_ms}ms` : "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{timeAgo(d.created_at as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Audit Center ────────────────────────────────────────────────────────────

function AuditCenter() {
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const params = filter !== "all" ? `?action_category=${filter}` : "";
    const r = await fetch(`/api/audit/logs${params}`);
    if (r.ok) {
      const d = await r.json();
      setLogs(d.logs || []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const categoryColors: Record<string, string> = {
    api_keys: "bg-violet-500/15 text-violet-400",
    webhooks: "bg-blue-500/15 text-blue-400",
    sync: "bg-emerald-500/15 text-emerald-400",
    integrations: "bg-cyan-500/15 text-cyan-400",
    settings: "bg-amber-500/15 text-amber-400",
    auth: "bg-slate-500/15 text-slate-400",
    security: "bg-red-500/15 text-red-400",
  };

  const categories = ["all", "api_keys", "webhooks", "sync", "integrations", "settings", "auth", "security"];

  return (
    <div>
      <SectionHeader
        icon={<Terminal className="h-4 w-4" />}
        title="Audit Center"
        subtitle="Immutable audit trail for all system actions"
      />

      <div className="mb-4 flex gap-1.5 flex-wrap">
        {categories.map(c => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${filter === c ? "bg-violet-600 text-white" : "border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}
          >
            {c.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading audit logs…</div>
      ) : logs.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <Terminal className="mx-auto h-8 w-8 text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No audit logs yet.</p>
        </GlassCard>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60">
              <tr>
                {["Action", "Category", "Target", "User", "IP", "Time"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-900/40">
              {logs.slice(0, 25).map((log: Record<string, unknown>) => (
                <tr key={log.id as string} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-slate-300">{log.action_type as string}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${categoryColors[log.action_category as string] || "bg-slate-500/15 text-slate-400"}`}>
                      {log.action_category as string}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{log.target_name as string || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-400">{log.user_email as string || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{log.ip_address as string || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{timeAgo(log.created_at as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Auto Sync Toggle ─────────────────────────────────────────────────────────

function AutoSyncToggle({ intgId, enabled, onToggled }: { intgId: string; enabled: boolean; onToggled: () => void }) {
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    await fetch("/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: intgId, auto_sync_enabled: !enabled }),
    });
    setLoading(false);
    onToggled();
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
        enabled
          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
          : "bg-slate-700/50 text-slate-400 border border-slate-600/40 hover:bg-slate-700"
      }`}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <div className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-400" : "bg-slate-500"}`} />
      )}
      {enabled ? "Enabled" : "Disabled"}
    </button>
  );
}

// ─── Event Inspector ─────────────────────────────────────────────────────────

interface IncomingEvent {
  id: string;
  event_id: string;
  event_name: string;
  source_ip: string | null;
  status: "processed" | "ignored" | "partial" | "failed" | "processing";
  processing_duration_ms: number | null;
  handler_used: string | null;
  error_message: string | null;
  error_type: string | null;
  result_contact_id: string | null;
  result_order_ref: string | null;
  signature_status: string;
  payload: Record<string, unknown> | null;
  processing_steps: { time: string; step: string; detail?: string; ok: boolean }[] | null;
  debug_info: Record<string, unknown> | null;
  retry_count: number;
  created_at: string;
}

function EventStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    processed: { label: "Processed", cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30", dot: "bg-emerald-400" },
    ignored:   { label: "Ignored",   cls: "bg-amber-500/15 text-amber-400 border border-amber-500/30",   dot: "bg-amber-400" },
    partial:   { label: "Partial",   cls: "bg-orange-500/15 text-orange-400 border border-orange-500/30", dot: "bg-orange-400" },
    failed:    { label: "Failed",    cls: "bg-red-500/15 text-red-400 border border-red-500/30",         dot: "bg-red-400" },
    processing:{ label: "Processing",cls: "bg-blue-500/15 text-blue-400 border border-blue-500/30",      dot: "bg-blue-400 animate-pulse" },
  };
  const s = map[status] || map.ignored;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SigBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    valid:    "text-emerald-400",
    bypassed: "text-amber-400",
    missing:  "text-red-400",
    invalid:  "text-red-400",
    unknown:  "text-slate-500",
  };
  return <span className={`text-xs font-mono ${map[status] || map.unknown}`}>{status}</span>;
}

function JsonViewer({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const raw = JSON.stringify(data, null, 2);

  const highlighted = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/("[^"]+")\s*:/g, '<span class="text-violet-300">$1</span>:')
    .replace(/:\s*("[^"]*")/g, ': <span class="text-emerald-300">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="text-amber-300">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="text-blue-300">$1</span>');

  const lines = highlighted.split("\n");
  const filtered = search
    ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : lines;

  const handleCopy = () => {
    navigator.clipboard.writeText(raw).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/60 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <Hash className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs text-slate-400">Raw Payload</span>
          <span className="text-xs text-slate-600">({raw.length} bytes)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="rounded pl-6 pr-2 py-1 text-xs bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500 w-32"
            />
          </div>
          <button onClick={() => setCollapsed(c => !c)} className="rounded p-1 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          <button onClick={handleCopy} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors text-xs">
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="overflow-auto max-h-64 p-3">
          <pre className="text-xs font-mono leading-relaxed">
            {filtered.map((line, i) => (
              <div key={i} className={`${search && line.toLowerCase().includes(search.toLowerCase()) ? "bg-violet-500/10" : ""}`}
                dangerouslySetInnerHTML={{ __html: line }}
              />
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

function ProcessingTimeline({ steps }: { steps: IncomingEvent["processing_steps"] }) {
  if (!steps || steps.length === 0) return <p className="text-xs text-slate-500">No timeline data.</p>;
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            {s.ok
              ? <div className="h-4 w-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center"><Check className="h-2.5 w-2.5 text-emerald-400" /></div>
              : <div className="h-4 w-4 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center"><X className="h-2.5 w-2.5 text-red-400" /></div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${s.ok ? "text-slate-200" : "text-red-300"}`}>{s.step}</span>
              {s.detail && <span className="text-xs text-slate-500 truncate">{s.detail}</span>}
            </div>
            <div className="text-xs text-slate-600 font-mono mt-0.5">{new Date(s.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
          </div>
          {i < steps.length - 1 && (
            <div className="absolute left-5 ml-1.5 mt-4 h-2 border-l border-slate-700" />
          )}
        </div>
      ))}
    </div>
  );
}

function EventInspectionModal({ ev, onClose }: { ev: IncomingEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
              <Telescope className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white font-mono">{ev.event_name}</h2>
              <p className="text-xs text-slate-500">Event Inspector</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Event Overview */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Event Overview</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                ["Event Name",   <span className="font-mono text-violet-300">{ev.event_name}</span>],
                ["Event ID",     <span className="font-mono text-xs text-slate-400">{ev.event_id}</span>],
                ["Status",       <EventStatusBadge status={ev.status} />],
                ["Signature",    <SigBadge status={ev.signature_status} />],
                ["Source IP",    <span className="font-mono text-xs">{ev.source_ip || "—"}</span>],
                ["Handler",      <span className="font-mono text-xs text-slate-400">{ev.handler_used || "none"}</span>],
                ["Received",     <span className="text-xs">{new Date(ev.created_at).toLocaleString()}</span>],
                ["Duration",     <span className="text-xs">{ev.processing_duration_ms != null ? `${ev.processing_duration_ms}ms` : "—"}</span>],
              ] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2">
                  <span className="text-xs text-slate-500">{k}</span>
                  <span className="text-xs text-slate-200 font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Created Records */}
          {(ev.result_contact_id || ev.result_order_ref) && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Created Records</h3>
              <div className="space-y-2">
                {ev.result_contact_id && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-xs text-slate-400">Contact ID:</span>
                    <span className="text-xs font-mono text-emerald-300">{ev.result_contact_id}</span>
                  </div>
                )}
                {ev.result_order_ref && (
                  <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2">
                    <Box className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-xs text-slate-400">Order Ref:</span>
                    <span className="text-xs font-mono text-blue-300">{ev.result_order_ref}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error Analysis */}
          {ev.status === "failed" && ev.error_message && (
            <div>
              <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" /> Error Analysis
              </h3>
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
                {ev.error_type && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Type:</span>
                    <span className="rounded px-2 py-0.5 text-xs bg-red-500/20 text-red-300 font-mono">{ev.error_type}</span>
                  </div>
                )}
                <div>
                  <span className="text-xs text-slate-500">Message:</span>
                  <pre className="mt-1 text-xs text-red-300 font-mono whitespace-pre-wrap break-all">{ev.error_message}</pre>
                </div>
              </div>
            </div>
          )}

          {/* Unknown Event Debug Info */}
          {ev.status === "ignored" && ev.debug_info && (
            <div>
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" /> Debug Info — Why Ignored
              </h3>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                {(ev.debug_info as any).reason && (
                  <p className="text-xs text-amber-300">{String((ev.debug_info as any).reason)}</p>
                )}
                {(ev.debug_info as any).recommendation && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                    <span className="text-xs font-semibold text-amber-300">Recommendation: </span>
                    <span className="text-xs text-slate-300">{String((ev.debug_info as any).recommendation)}</span>
                  </div>
                )}
                {Array.isArray((ev.debug_info as any).handlers_checked) && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">Handlers checked ({((ev.debug_info as any).handlers_checked as string[]).length}):</p>
                    <div className="flex flex-wrap gap-1">
                      {((ev.debug_info as any).handlers_checked as string[]).map(h => (
                        <span key={h} className="rounded px-1.5 py-0.5 text-xs bg-slate-800 text-slate-400 font-mono">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Processing Timeline */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Processing Timeline</h3>
            <GlassCard className="p-4">
              <ProcessingTimeline steps={ev.processing_steps} />
            </GlassCard>
          </div>

          {/* Raw Payload */}
          {ev.payload && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Raw Payload</h3>
              <JsonViewer data={ev.payload} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventInspector({ integration }: { integration: Integration }) {
  const [events, setEvents] = useState<IncomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<IncomingEvent | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterEvent, setFilterEvent] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams({
      integration_id: integration.id,
      limit: String(limit),
      offset: String(page * limit),
    });
    if (filterStatus) params.set("status", filterStatus);
    if (filterEvent) params.set("event_name", filterEvent);
    if (search) params.set("q", search);
    const r = await fetch(`/api/integrations/events?${params}`);
    if (r.ok) {
      const d = await r.json();
      setEvents(d.events || []);
      setTotal(d.total || 0);
      setStats(d.stats || {});
    }
    setLoading(false);
  }, [integration.id, page, filterStatus, filterEvent, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (liveMode) {
      liveTimerRef.current = setInterval(() => load(true), 5000);
    } else {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    }
    return () => { if (liveTimerRef.current) clearInterval(liveTimerRef.current); };
  }, [liveMode, load]);

  const STATUSES = ["processed", "ignored", "partial", "failed"];
  const statColors: Record<string, string> = {
    processed: "text-emerald-400",
    ignored:   "text-amber-400",
    partial:   "text-orange-400",
    failed:    "text-red-400",
  };

  return (
    <div>
      <SectionHeader
        icon={<Telescope className="h-4 w-4" />}
        title="Event Inspector"
        subtitle="Full forensic trail of every incoming event from Gilaf Store"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLiveMode(l => !l)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                liveMode
                  ? "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
                  : "border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"
              }`}
            >
              <Radio className={`h-3 w-3 ${liveMode ? "animate-pulse" : ""}`} />
              {liveMode ? "Live ON" : "Live OFF"}
            </button>
            <button onClick={() => load()} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Total (24h)" value={Object.values(stats).reduce((a, b) => a + b, 0)} color="violet" />
        <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label="Processed" value={stats.processed || 0} color="emerald" />
        <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="Ignored" value={stats.ignored || 0} color="amber" />
        <MetricCard icon={<XCircle className="h-4 w-4" />} label="Failed" value={stats.failed || 0} color={stats.failed > 0 ? "red" : "emerald"} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search event, phone, order ID…"
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select
          value={filterEvent}
          onChange={e => { setFilterEvent(e.target.value); setPage(0); }}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">All Events</option>
          {[
            "order.placed","order.confirmed","order.shipped","order.delivered","order.cancelled",
            "payment.success","payment.failed","cart.abandoned","cart.recovered",
            "customer.created","customer.updated","trigger.order_created","trigger.payment_success",
            "contact.tag_added","product.viewed","checkout.started",
          ].map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        {(search || filterStatus || filterEvent) && (
          <button onClick={() => { setSearch(""); setFilterStatus(""); setFilterEvent(""); setPage(0); }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Clear filters
          </button>
        )}
        {liveMode && (
          <span className="flex items-center gap-1.5 ml-auto text-xs text-red-400">
            <Radio className="h-3 w-3 animate-pulse" /> Live — refreshing every 5s
          </span>
        )}
      </div>

      {/* Events Table */}
      {loading ? (
        <div className="py-12 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div>
      ) : events.length === 0 ? (
        <GlassCard className="py-16 text-center">
          <Telescope className="mx-auto h-10 w-10 text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">No events yet.</p>
          <p className="text-xs text-slate-600 mt-1">Events will appear here as Gilaf Store sends webhooks.</p>
        </GlassCard>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60">
              <tr>
                {["Time", "Event", "Source", "Sig", "Status", "Duration", "Result", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-900/40">
              {events.map(ev => (
                <tr key={ev.id} className="hover:bg-slate-800/30 transition-colors group cursor-pointer" onClick={() => setSelected(ev)}>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono">
                    {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-violet-300">{ev.event_name}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{ev.source_ip || "—"}</td>
                  <td className="px-4 py-2.5"><SigBadge status={ev.signature_status} /></td>
                  <td className="px-4 py-2.5"><EventStatusBadge status={ev.status} /></td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {ev.processing_duration_ms != null ? `${ev.processing_duration_ms}ms` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {ev.result_contact_id && (
                      <span className="text-emerald-400">Contact ✓</span>
                    )}
                    {ev.result_order_ref && (
                      <span className="text-blue-400 ml-1">Order #{ev.result_order_ref}</span>
                    )}
                    {ev.error_message && (
                      <span className="text-red-400 truncate max-w-[120px] block">{ev.error_message.slice(0, 40)}</span>
                    )}
                    {ev.status === "ignored" && !ev.error_message && (
                      <span className="text-amber-500">Unknown Event</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-violet-400 hover:text-violet-300">
                      <Telescope className="h-3.5 w-3.5" />
                      <span>Inspect</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">{total} total events · page {page + 1} of {Math.ceil(total / limit)}</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-40 transition-colors">
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-40 transition-colors">
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Inspection Modal */}
      {selected && <EventInspectionModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ─── Regenerate Website API Key ───────────────────────────────────────────────

function RegenerateWebsiteKey({ intgId, onRefresh }: { intgId: string; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const regenerate = async () => {
    if (!confirm("Regenerate the Website API Key?\n\nThe old key will stop working immediately. You must update GilafStore with the new key.")) return;
    setLoading(true);
    // Generate a new key client-side (same format as server)
    const array = new Uint8Array(20);
    crypto.getRandomValues(array);
    const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    const generatedKey = `gsk_${hex}`;

    const r = await fetch("/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: intgId, website_api_key: generatedKey }),
    });
    setLoading(false);
    if (r.ok) {
      setNewKey(generatedKey);
      onRefresh();
    } else {
      alert("Failed to regenerate key. Try again.");
    }
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      });
    }
  };

  return (
    <GlassCard className="p-5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Website API Key (for sync)</h3>
      <p className="text-xs text-slate-400 mb-4">
        This key is sent by WACRM when pulling data from your website&apos;s <code className="text-violet-300">/api/crm/*</code> endpoints. 
        Paste this same key in GilafStore → Admin → CE WACRM Test → &quot;WACRM API Key&quot; field.
      </p>
      {newKey ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-400">New Key Generated — Copy Now!</span>
            </div>
            <p className="text-xs text-slate-400 mb-2">This is the only time you&apos;ll see the full key. Paste it in GilafStore.</p>
            <div className="flex items-center gap-2 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2">
              <code className="flex-1 text-xs text-violet-300 font-mono break-all select-all">{newKey}</code>
              <button onClick={handleCopy} className="shrink-0 text-slate-400 hover:text-white transition-colors">
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-400 mt-1">✓ Copied to clipboard!</p>}
          </div>
        </div>
      ) : (
        <button
          onClick={regenerate}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Regenerate Website API Key
        </button>
      )}
    </GlassCard>
  );
}

// ─── Enterprise Detail View ───────────────────────────────────────────────────

type EnterpriseTab = "overview" | "keys" | "security" | "health" | "monitor" | "sync" | "webhooks" | "events" | "audit";

function EnterpriseDetail({ intg, onBack, onRefresh }: { intg: Integration; onBack: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<EnterpriseTab>("overview");

  const tabs: { id: EnterpriseTab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview",  icon: <BarChart2 className="h-3.5 w-3.5" /> },
    { id: "keys",     label: "API Keys",  icon: <Key className="h-3.5 w-3.5" /> },
    { id: "security", label: "Security",  icon: <Shield className="h-3.5 w-3.5" /> },
    { id: "health",   label: "Health",    icon: <Activity className="h-3.5 w-3.5" /> },
    { id: "monitor",  label: "Monitor",   icon: <Zap className="h-3.5 w-3.5" /> },
    { id: "sync",     label: "Sync",      icon: <RefreshCw className="h-3.5 w-3.5" /> },
    { id: "webhooks", label: "Webhooks",  icon: <Webhook className="h-3.5 w-3.5" /> },
    { id: "events",   label: "Events",    icon: <Telescope className="h-3.5 w-3.5" /> },
    { id: "audit",    label: "Audit",     icon: <Terminal className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
                ← Back
              </button>
              <div className="h-5 w-px bg-white/10" />
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-sm font-bold text-white shadow-lg">
                  {intg.website_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-sm font-semibold text-white">{intg.website_name}</h1>
                  <a href={intg.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                    {intg.website_url} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill status={intg.status} />
              <div className="text-xs text-slate-500">
                Score: <span className={`font-semibold ${intg.health_score >= 80 ? "text-emerald-400" : intg.health_score >= 60 ? "text-amber-400" : "text-red-400"}`}>{intg.health_score}/100</span>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <nav className="mt-4 flex gap-1 overflow-x-auto">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        {tab === "overview" && (
          <div className="space-y-8">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard icon={<Activity className="h-4 w-4" />} label="Health Score" value={`${intg.health_score}/100`} color="violet" />
              <MetricCard icon={<Webhook className="h-4 w-4" />} label="Webhooks Sent" value={intg.total_webhooks_sent} sub={`${intg.total_webhooks_failed} failed`} color={intg.total_webhooks_failed > 0 ? "amber" : "emerald"} />
              <MetricCard icon={<RefreshCw className="h-4 w-4" />} label="Last Sync" value={timeAgo(intg.last_sync_at)} sub={`${intg.total_synced_contacts} contacts`} color="blue" />
              <MetricCard icon={<Wifi className="h-4 w-4" />} label="Heartbeat" value={intg.heartbeat_latency_ms ? `${intg.heartbeat_latency_ms}ms` : "—"} sub={timeAgo(intg.last_heartbeat_at)} color="emerald" />
            </div>

            {/* Integration Info */}
            <GlassCard className="p-5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Integration Details</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
                {([
                  ["API Key", <span key="ak" className="font-mono text-xs">{intg.website_api_key?.slice(0, 8)}••••••••</span>],
                  ["Platform", intg.platform || "custom"],
                  ["Detected Version", intg.discovered_version || "—"],
                  ["Created", new Date(intg.created_at).toLocaleDateString()],
                  ["Auto Sync", <AutoSyncToggle key="ast" intgId={intg.id} enabled={intg.auto_sync_enabled} onToggled={onRefresh} />],
                  ["Sync Interval", `${intg.sync_interval_min}s`],
                  ["Status", <StatusPill key="sp" status={intg.status} />],
                  ["Consecutive Failures", String(intg.consecutive_sync_failures)],
                ] as [string, ReactNode][]).map(([k, v], i) => (
                  <div key={i} className="flex justify-between border-b border-white/5 pb-2.5">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-200 font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Regenerate Website API Key */}
            <RegenerateWebsiteKey intgId={intg.id} onRefresh={onRefresh} />
          </div>
        )}

        {tab === "keys"     && <ApiKeyManager />}
        {tab === "security" && <SecurityCenter />}
        {tab === "health"   && <HealthCenter integration={intg} />}
        {tab === "monitor"  && <RealtimeMonitor />}
        {tab === "sync"     && <SyncCenter integration={intg} onRefresh={onRefresh} />}
        {tab === "webhooks" && <WebhookCenter integration={intg} />}
        {tab === "events"   && <EventInspector integration={intg} />}
        {tab === "audit"    && <AuditCenter />}
      </div>
    </div>
  );
}

// ─── Integration List ────────────────────────────────────────────────────────

function IntegrationsList({ onSelect }: { onSelect: (intg: Integration) => void }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/integrations");
    const d = await r.json();
    setIntegrations(d.integrations || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteIntegration = async (e: React.MouseEvent, intg: Integration) => {
    e.stopPropagation();
    if (!confirm(`Delete "${intg.website_name}"?\n\nThis will permanently remove this integration, all API keys, and webhook history. This action cannot be undone.`)) return;
    setDeleting(intg.id);
    try {
      const r = await fetch(`/api/integrations?id=${intg.id}`, { method: "DELETE" });
      const d = await r.json();
      if (d.success) {
        setIntegrations(prev => prev.filter(i => i.id !== intg.id));
      } else {
        alert("Failed to delete: " + (d.error || "Unknown error"));
      }
    } catch {
      alert("Network error while deleting integration.");
    }
    setDeleting(null);
  };

  const filtered = integrations.filter(i =>
    i.website_name.toLowerCase().includes(search.toLowerCase()) ||
    i.website_url.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search integrations…"
            className="w-full rounded-xl border border-slate-700 bg-slate-800/60 pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <GlassCard className="py-16 text-center">
          <Globe className="mx-auto h-12 w-12 text-slate-700 mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No integrations yet</h3>
          <p className="text-sm text-slate-500">Connect your first website to get started.</p>
        </GlassCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(intg => {
            const healthColor = intg.health_score >= 80 ? "text-emerald-400" : intg.health_score >= 60 ? "text-amber-400" : "text-red-400";
            const healthBg = intg.health_score >= 80 ? "from-emerald-500/5 to-transparent" : intg.health_score >= 60 ? "from-amber-500/5 to-transparent" : "from-red-500/5 to-transparent";
            const isDeleting = deleting === intg.id;
            return (
              <button
                key={intg.id}
                onClick={() => onSelect(intg)}
                disabled={isDeleting}
                className={`group relative rounded-2xl border border-white/5 bg-gradient-to-b ${healthBg} bg-slate-900/60 p-5 text-left backdrop-blur-sm hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-200 shadow-xl ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-sm font-bold text-white shadow-lg">
                      {intg.website_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-100 text-sm">{intg.website_name}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[120px]">{intg.website_url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={intg.status} />
                    <button
                      onClick={(e) => deleteIntegration(e, intg)}
                      disabled={isDeleting}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/25 hover:border-red-500/50 hover:text-red-300 transition-all duration-150 disabled:opacity-50"
                      title={`Delete ${intg.website_name}`}
                    >
                      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                    <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Health Score</span>
                    <span className={`font-semibold ${healthColor}`}>{intg.health_score}/100</span>
                  </div>
                  <MiniBar
                    value={intg.health_score}
                    max={100}
                    color={intg.health_score >= 80 ? "bg-emerald-500" : intg.health_score >= 60 ? "bg-amber-500" : "bg-red-500"}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-800/60 px-2 py-1.5">
                    <div className="text-xs font-semibold text-slate-200">{intg.total_webhooks_sent}</div>
                    <div className="text-xs text-slate-500">Webhooks</div>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 px-2 py-1.5">
                    <div className="text-xs font-semibold text-slate-200">{intg.total_synced_contacts}</div>
                    <div className="text-xs text-slate-500">Contacts</div>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 px-2 py-1.5">
                    <div className="text-xs font-semibold text-slate-200">{timeAgo(intg.last_sync_at)}</div>
                    <div className="text-xs text-slate-500">Last Sync</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── One-time Credentials Modal ─────────────────────────────────────────────

function CredentialsModal({ data, onDone }: { data: Record<string, unknown>; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const fields = [
    { label: "WACRM API Key",                    key: "connection_token" },
    { label: "Signing Secret (outbound HMAC)",   key: "website_secret"   },
    { label: "Inbound Secret (verify WACRM→us)", key: "webhook_secret"   },
  ];

  const handleCopy = (key: string) => {
    const val = String(data[key] ?? "");
    navigator.clipboard.writeText(val).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const copyAll = () => {
    const text = fields.map(f => `${f.label}:\n${String(data[f.key] ?? "")}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied("__all__");
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 flex items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <div className="mb-4 flex items-center gap-3">
          <Shield className="h-6 w-6 text-amber-400" />
          <h2 className="text-lg font-bold text-amber-300">Save Your Credentials — Shown Once!</h2>
        </div>
        <p className="mb-6 text-sm text-amber-200/70">These secrets will never be shown again. Copy them now and store securely.</p>

        <div className="space-y-3">
          {fields.map(({ label, key }) => {
            const val = String(data[key] ?? "");
            const isCopied = copied === key;
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs text-slate-400">{label}</p>
                  {isCopied && <span className="text-[10px] text-emerald-400 font-medium">✓ Copied!</span>}
                </div>
                <div className={`flex items-center gap-2 rounded-lg border bg-slate-900 px-3 py-2.5 transition-colors ${isCopied ? "border-emerald-500/50" : "border-slate-700"}`}>
                  <code className="flex-1 break-all font-mono text-xs text-emerald-300 select-all">{val}</code>
                  <button
                    onClick={() => handleCopy(key)}
                    className={`shrink-0 rounded p-1 transition-colors ${isCopied ? "text-emerald-400" : "text-slate-500 hover:text-white hover:bg-slate-700"}`}
                    title={`Copy ${label}`}
                  >
                    {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={copyAll}
          className={`mt-4 w-full flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors ${
            copied === "__all__"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-600 hover:text-white"
          }`}
        >
          {copied === "__all__" ? <><Check className="h-4 w-4" /> All Copied!</> : <><Copy className="h-4 w-4" /> Copy All 3 Credentials</>}
        </button>

        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400">
          <strong className="text-slate-300">Setup:</strong> Go to <strong className="text-slate-200">gilafstore.com/admin/ce_wacrm_test.php</strong> → Step 1 → paste each value into its matching field: <em>WACRM API Key</em>, <em>Signing Secret</em>, <em>Inbound Secret</em> → Save Config.
        </div>
        <button onClick={onDone} className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
          ✓ I&apos;ve saved my credentials — Continue
        </button>
      </div>
    </div>
  );
}

// ─── Add Integration Form ────────────────────────────────────────────────────

function AddIntegrationForm({ onCreated, onCancel }: { onCreated: (data: Record<string, unknown>) => void; onCancel: () => void }) {
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
  const toggleEvent = (ev: string) => setForm(f => ({
    ...f,
    webhook_events: f.webhook_events.includes(ev)
      ? f.webhook_events.filter(e => e !== ev)
      : [...f.webhook_events, ev],
  }));

  const autoDiscover = async () => {
    if (!form.website_url) return;
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/integrations/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (data.success) onCreated(data);
      else alert(data.error ?? "Failed to create");
    } catch { alert("Network error"); }
    setSaving(false);
  };

  return (
    <GlassCard className="p-8 mx-auto max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-lg font-bold text-white">Connect a Website</h2>
        <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
      </div>

      {/* Steps indicator */}
      <div className="mb-8 flex items-center gap-0">
        {[1, 2, 3, 4].map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <button onClick={() => s < step && setStep(s)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all ${
                s < step ? "bg-emerald-500 text-white cursor-pointer"
                : s === step ? "bg-violet-600 text-white ring-2 ring-violet-400/40"
                : "bg-slate-800 text-slate-500"
              }`}>{s < step ? "✓" : s}
            </button>
            {i < 3 && <div className={`flex-1 h-0.5 mx-1 ${s < step ? "bg-emerald-500" : "bg-slate-800"}`} />}
          </div>
        ))}
      </div>
      <div className="mb-6 flex gap-2 text-[11px] text-slate-500 justify-between">
        {["Website Info", "API Key", "Webhooks", "Confirm"].map(l => <span key={l} className="flex-1 text-center">{l}</span>)}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Website Name *</label>
            <input className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500" placeholder="GilafStore" value={form.website_name} onChange={e => set("website_name", e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Website URL *</label>
            <input className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500" placeholder="https://yourstore.com" value={form.website_url} onChange={e => set("website_url", e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Platform</label>
            <select className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500" value={form.platform} onChange={e => set("platform", e.target.value)}>
              {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <button onClick={autoDiscover} disabled={!form.website_url || testing}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 py-2.5 text-sm font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-50">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Auto Detect Platform
          </button>
          {testResult && (
            <div className={`rounded-lg border p-3 text-sm ${
              testResult.connected ? "border-emerald-500/30 bg-emerald-500/10" : testResult.site_reachable ? "border-blue-500/30 bg-blue-500/10" : "border-amber-500/30 bg-amber-500/10"
            }`}>
              <p className={testResult.connected ? "text-emerald-300" : testResult.site_reachable ? "text-blue-300" : "text-amber-300"}>
                {String(testResult.recommendation ?? "")}
              </p>
            </div>
          )}
          <button onClick={() => setStep(2)} disabled={!form.website_name || !form.website_url} className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
            Continue <ChevronRight className="inline h-4 w-4" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Website API Key</label>
            <input className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500" placeholder="Leave blank to auto-generate" value={form.website_api_key} onChange={e => set("website_api_key", e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Webhook URL</label>
            <input className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500" placeholder="https://yourstore.com/api/wacrm-webhook" value={form.webhook_url} onChange={e => set("webhook_url", e.target.value)} />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-400 hover:bg-slate-800">← Back</button>
            <button onClick={() => setStep(3)} className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">Continue <ChevronRight className="inline h-4 w-4" /></button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <p className="text-sm text-slate-400">Choose which events WACRM should send to your website:</p>
          <div className="grid grid-cols-2 gap-2">
            {ALL_EVENTS.map(ev => (
              <button key={ev} onClick={() => toggleEvent(ev)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  form.webhook_events.includes(ev) ? "border-violet-500/40 bg-violet-500/15 text-violet-200" : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
                }`}>
                <div className={`h-2 w-2 rounded-full ${form.webhook_events.includes(ev) ? "bg-violet-400" : "bg-slate-600"}`} />{ev}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-400 hover:bg-slate-800">← Back</button>
            <button onClick={() => setStep(4)} className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">Review <ChevronRight className="inline h-4 w-4" /></button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3 text-sm">
            {[{l: "Website", v: form.website_name}, {l: "URL", v: form.website_url}, {l: "Platform", v: PLATFORMS.find(p => p.value === form.platform)?.label ?? form.platform}, {l: "API Key", v: form.website_api_key || "(auto-generate)"}, {l: "Webhook URL", v: form.webhook_url || "(not set)"}, {l: "Events", v: `${form.webhook_events.length} selected`}].map(({l, v}) => (
              <div key={l} className="flex items-start justify-between gap-4"><span className="shrink-0 text-slate-500">{l}</span><span className="text-right text-slate-200 font-mono text-xs">{v}</span></div>
            ))}
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            ⚠ After saving, your credentials will be shown <strong>once</strong>. Copy and store them securely.
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(3)} className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-400 hover:bg-slate-800">← Back</button>
            <button onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Saving…" : "Save Integration"}
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function EnterpriseIntegrationsPage() {
  const [selected, setSelected] = useState<Integration | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [newCredentials, setNewCredentials] = useState<Record<string, unknown> | null>(null);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  const handleCreated = (data: Record<string, unknown>) => {
    setShowAdd(false);
    setNewCredentials(data);
    setRefreshKey(k => k + 1);
  };

  // One-time credentials modal — shown immediately after creating an integration
  if (newCredentials) {
    return <CredentialsModal data={newCredentials} onDone={() => setNewCredentials(null)} />;
  }

  if (selected) {
    return (
      <EnterpriseDetail
        intg={selected}
        onBack={() => setSelected(null)}
        onRefresh={handleRefresh}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Page Header */}
      <div className="border-b border-white/5 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-5 w-5 text-violet-400" />
                <h1 className="text-xl font-bold text-white">Integration Control Center</h1>
              </div>
              <p className="text-sm text-slate-500">Enterprise-grade CRM integration management</p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 shadow-lg shadow-violet-500/20 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Integration
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {showAdd ? (
          <AddIntegrationForm onCreated={handleCreated} onCancel={() => setShowAdd(false)} />
        ) : (
          <IntegrationsList key={refreshKey} onSelect={setSelected} />
        )}
      </div>
    </div>
  );
}
