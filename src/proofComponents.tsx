import { CheckCircle2, XCircle } from "lucide-react";
import type React from "react";
import type { CheckStatus, Proof, Property } from "./types";
import { Badge, RiskBadge, currency, dateShort } from "./ui";

type Detail = {
  label: string;
  value: React.ReactNode;
};

export const approvedCheckLabels = {
  incomeCheck: "Income requirement met",
  cashflowCheck: "Stable cashflow",
  savingsCheck: "Sufficient savings buffer",
  debtCheck: "Debt level acceptable",
} satisfies Record<keyof Proof["checks"], string>;

export const rejectedCheckLabels = {
  incomeCheck: "Income requirement not met",
  cashflowCheck: "Cashflow too low",
  savingsCheck: "Insufficient emergency buffer",
  debtCheck: "Debt level too high",
} satisfies Record<keyof Proof["checks"], string>;

export function ProofStatusHeader({
  proof,
  title,
  subtitle,
}: {
  proof: Proof;
  title: string;
  subtitle?: string;
}) {
  const approved = proof.status === "Tenant Verified";

  return (
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
      <div>
        <Badge tone={approved ? "green" : "rose"}>{approved ? "Tenant Verified" : "Verification failed"}</Badge>
        <h1 className="mt-4 text-4xl font-bold text-navy-950">{title}</h1>
        {subtitle ? <p className="mt-3 max-w-2xl text-slate-600">{subtitle}</p> : null}
      </div>
      <RiskBadge risk={proof.riskLevel} />
    </div>
  );
}

export function ProofDetailsGrid({ details }: { details: Detail[] }) {
  return (
    <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {details.map((detail) => (
        <div key={detail.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{detail.label}</p>
          <div className="mt-2 break-words text-base font-bold text-navy-950">{detail.value}</div>
        </div>
      ))}
    </div>
  );
}

export function ProofChecksList({
  checks,
  labels,
  failedOnly = false,
}: {
  checks: Proof["checks"];
  labels: Record<keyof Proof["checks"], string>;
  failedOnly?: boolean;
}) {
  const rows = (Object.entries(checks) as Array<[keyof Proof["checks"], CheckStatus]>).filter(
    ([, value]) => !failedOnly || value === "failed",
  );

  return (
    <div className="mt-7 grid gap-3 sm:grid-cols-2">
      {rows.map(([key, value]) => (
        <CheckOutcome key={key} label={labels[key]} value={value} />
      ))}
    </div>
  );
}

export function ProofPrivacyText() {
  return (
    <p className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold leading-6 text-slate-600">
      Your financial details are used only inside the local proof flow. The landlord can only see the proof, not the underlying data.
    </p>
  );
}

export function ProofSummary({ proof, property }: { proof: Proof; property?: Property }) {
  const approved = proof.status === "Tenant Verified";

  return (
    <div className="card p-6">
      <ProofStatusHeader
        proof={proof}
        title={approved ? "Tenant Verified" : "Verification failed"}
        subtitle={property?.title ?? "ProofRent verification"}
      />
      <ProofDetailsGrid
        details={[
          { label: "Proof ID", value: proof.id },
          { label: "Tenant Wallet", value: proof.tenantWallet },
          { label: "Valid for", value: "30 days" },
          { label: "Valid until", value: dateShort(proof.expiresAt) },
          { label: "Compatible rent", value: `${currency(proof.compatibleRentRange.min)}-${currency(proof.compatibleRentRange.max)}/month` },
          { label: "Attestation", value: proof.attestationStatus === "attested" ? "Attested" : "Failed" },
          ...(property ? [{ label: "Monthly rent", value: `${currency(property.rent)}/month` }] : []),
        ]}
      />
      <ProofChecksList checks={proof.checks} labels={approved ? approvedCheckLabels : rejectedCheckLabels} failedOnly={!approved} />
    </div>
  );
}

function CheckOutcome({ label, value }: { label: string; value: CheckStatus }) {
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
