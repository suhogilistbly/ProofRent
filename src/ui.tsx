import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { CheckStatus, Proof } from "./types";

export const currency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value: string, options: Intl.DateTimeFormatOptions) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", options).format(date);
};

export const dateShort = (value: string) =>
  formatDate(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const dateTimeShort = (value: string) =>
  formatDate(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const variants = {
    primary: "bg-navy-950 text-white hover:bg-navy-800",
    secondary: "border border-slate-200 bg-white text-navy-950 hover:bg-slate-50",
    ghost: "text-navy-900 hover:bg-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };

  return (
    <button
      className={`focus-ring inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "green" | "amber" | "rose" | "slate" | "navy";
}) {
  const tones = {
    green: "bg-verified-50 text-verified-700 ring-verified-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    navy: "bg-navy-950 text-white ring-navy-800",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ proof }: { proof: Proof }) {
  return proof.status === "Tenant Verified" ? (
    <Badge tone="green">Tenant Verified</Badge>
  ) : (
    <Badge tone="rose">Not Verified</Badge>
  );
}

export function RiskBadge({ risk }: { risk: Proof["riskLevel"] }) {
  const tone = risk === "low" ? "green" : risk === "medium" ? "amber" : "rose";
  return <Badge tone={tone}>{risk[0].toUpperCase() + risk.slice(1)} Risk</Badge>;
}

export function CheckRow({ label, value }: { label: string; value: CheckStatus }) {
  const passed = value === "passed";
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className={`inline-flex items-center gap-2 text-sm font-semibold ${passed ? "text-verified-700" : "text-rose-700"}`}>
        {passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {passed ? "Passed" : "Failed"}
      </span>
    </div>
  );
}

export function PrivacyPanel() {
  return (
    <div className="card bg-navy-950 p-6 text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-verified-500/15 text-verified-100">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-lg font-semibold">Privacy-preserving by design</h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        This MVP models a simulated confidential execution handoff: source signals are evaluated through
        a MagicBlock-compatible provider boundary, then discarded. Landlords only see verification status, risk,
        proof ID, expiration, and check outcomes.
      </p>
    </div>
  );
}
