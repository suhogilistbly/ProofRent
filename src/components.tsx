import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  DatabaseZap,
  FileCheck2,
  Home,
  KeyRound,
  Lock,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Application, CheckStatus, Proof, Property } from "./types";
import { verifyProof as verifyProofBackend, type ProofVerificationResult } from "./proofApi";
import { Badge, Button, RiskBadge, StatusBadge, currency, dateShort, dateTimeShort } from "./ui";

export const PRIVACY_REMINDERS = [
  "Raw financial data is never shown to the landlord.",
  "Only proof is shared.",
  "Proof can be reused for multiple properties if still valid.",
  "Verification is routed through a simulated confidential execution provider boundary.",
];

type Tone = "green" | "amber" | "rose" | "slate" | "navy";

export const isBackendAcceptedForLandlord = (verification?: ProofVerificationResult | null) =>
  Boolean(
    verification?.valid &&
      verification.trustedIssuerValid &&
      !verification.expired &&
      !verification.revoked,
  );

export function BackendVerificationBadge({
  verification,
  unavailable,
}: {
  verification?: ProofVerificationResult | null;
  unavailable?: boolean;
}) {
  if (unavailable) return <Badge tone="amber">Verification unavailable</Badge>;
  if (!verification) return <Badge tone="amber">Verification unavailable</Badge>;
  if (isBackendAcceptedForLandlord(verification)) return <Badge tone="green">Backend verified</Badge>;
  return <Badge tone="rose">Backend rejected</Badge>;
}

export const isSimulationOnlyProof = (proof?: Proof) =>
  proof?.executionMetadata?.provider === "local-simulation" || proof?.onChainCommitment?.configured === false;

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-3 font-bold text-navy-950">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-navy-950 text-white shadow-soft">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="truncate">ProofRent</span>
        </Link>
        <nav className="hidden items-center gap-2 md:flex">
          <NavItem to="/properties">Properties</NavItem>
          <NavItem to="/tenant/passport">Passports</NavItem>
          <NavItem to="/landlord">Landlord</NavItem>
          <NavItem to="/magicblock-status">MagicBlock</NavItem>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/demo"
            className="focus-ring inline-flex items-center gap-2 rounded-full border border-verified-200 bg-white px-4 py-2 text-sm font-semibold text-verified-700 transition hover:bg-verified-50"
          >
            Demo <Sparkles className="h-4 w-4" />
          </Link>
          <Link
            to="/properties"
            className="focus-ring hidden items-center gap-2 rounded-full bg-verified-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-verified-700 sm:inline-flex"
          >
            Start proof <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-navy-950"
    >
      {children}
    </Link>
  );
}

export function HeroSection({
  latestProof,
  demoPropertyId,
}: {
  latestProof?: Proof;
  demoPropertyId: string;
}) {
  return (
    <section className="relative overflow-hidden bg-navy-950 text-white">
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1800&q=80"
          alt="Modern apartment interior"
          className="h-full w-full object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-950/90 to-navy-900/35" />
      </div>
      <div className="container-page relative grid min-h-[620px] items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="green">Built for the MagicBlock Privacy Track</Badge>
            <Badge tone="navy">Powered by Solana + MagicBlock-compatible confidential execution</Badge>
          </div>
          <h1 className="mt-7 max-w-3xl text-4xl font-bold leading-tight tracking-normal text-white sm:text-5xl md:text-7xl">
            Private rental proofs for the Solana housing market.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            ProofRent lets renters prove eligibility once, reuse the proof across listings, and keep bank statements, payroll records, debt, and savings out of landlord inboxes.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/demo">
              <Button>
                Run judge demo <Sparkles className="h-4 w-4" />
              </Button>
            </Link>
            <Link to={`/verify/${demoPropertyId}`}>
              <Button variant="secondary">Start private proof</Button>
            </Link>
          </div>
        </div>
        <div className="card border-white/10 bg-white/95 p-5 text-navy-950 shadow-soft">
          <div className="rounded-2xl bg-slate-50 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">Reusable confidential proof</p>
                <h2 className="mt-1 text-2xl font-bold text-navy-950">Tenant Verified</h2>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-verified-100 text-verified-700">
                <UserRoundCheck className="h-7 w-7" />
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                ["Proof ID", latestProof?.id ?? "proof_demo"],
                ["Rent range", latestProof ? `$0-$${latestProof.compatibleRentRange.max}` : "$0-$1,600"],
                ["Valid until", latestProof ? dateShort(latestProof.expiresAt) : "Jun 8, 2026"],
                ["Raw data", "Never shared"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-white p-4 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
                  <p className="mt-2 truncate text-sm font-bold text-navy-950">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Landlord sees</p>
              <p className="mt-2 text-sm font-bold text-navy-950">Compatible rent, risk tier, expiry, wallet signature, and attestation status.</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">No PDFs. No bank history. No raw payroll data.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PropertyCard({ property }: { property: Property }) {
  return (
    <article className="card group flex h-full flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-soft">
      <Link to={`/property/${property.id}`} className="block">
        <div className="aspect-[4/3] overflow-hidden bg-slate-100">
          <img src={property.image} alt={property.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to={`/property/${property.id}`} className="text-lg font-bold text-navy-950 transition hover:text-verified-700">
              {property.title}
            </Link>
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-500">
              <MapPin className="h-4 w-4 shrink-0" /> {property.location}
            </p>
          </div>
          <p className="whitespace-nowrap text-sm font-bold text-navy-950">{currency(property.rent)}/month</p>
        </div>
        <p className="mt-4 flex-1 text-sm leading-6 text-slate-600">{property.description}</p>
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-500">
          Only proof is shared. Raw financial data is never shown to the landlord.
        </div>
        <Link to={`/property/${property.id}`} className="mt-5">
          <Button className="w-full">
            Apply privately <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </article>
  );
}

export function DataSourceCard({
  icon,
  title,
  description,
  connected,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  connected?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-navy-950">
          {icon ?? <DatabaseZap className="h-5 w-5" />}
        </div>
        <Badge tone={connected ? "green" : "slate"}>{connected ? "Connected" : "Private input"}</Badge>
      </div>
      <h3 className="mt-5 text-base font-bold text-navy-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

export function PrivateDataForm({
  values,
  onChange,
}: {
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <Lock className="mt-1 h-5 w-5 shrink-0 text-verified-700" />
        <div>
          <h3 className="text-lg font-bold text-navy-950">Private financial profile</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
            Verification is routed through a simulated confidential execution provider boundary. Only proof is shared.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {Object.entries(values).map(([key, value]) => (
          <label key={key} className="block">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{key}</span>
            <input
              type="number"
              min="0"
              value={value}
              onChange={(event) => onChange(key, Number(event.target.value))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-navy-950 outline-none transition focus:border-verified-500 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function VerificationProgress({ currentStep }: { currentStep: number }) {
  const steps = ["Connect", "Compute", "Generate", "Share"];
  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {steps.map((step, index) => {
          const active = index + 1 <= currentStep;
          return (
            <div key={step} className={`rounded-2xl border p-4 ${active ? "border-verified-100 bg-verified-50" : "border-slate-200 bg-slate-50"}`}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${active ? "bg-verified-600 text-white" : "bg-white text-slate-400"}`}>
                {active ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              </div>
              <p className="mt-3 text-sm font-bold text-navy-950">{step}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProofResultCard({ proof, property }: { proof: Proof; property?: Property }) {
  const approved = proof.status === "Tenant Verified";
  return (
    <section className="card p-6 md:p-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <ProofBadge proof={proof} />
          <h2 className="mt-4 text-3xl font-bold text-navy-950">{approved ? "Tenant verified" : "Proof not approved"}</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {property ? `Compatible with ${property.title}` : "Reusable ProofRent verification"}
          </p>
        </div>
        <RiskBadge risk={proof.riskLevel} />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Proof ID" value={proof.id} />
        <Metric label="Tenant wallet" value={proof.tenantWallet} />
        <Metric label="Valid until" value={dateShort(proof.expiresAt)} />
        <Metric label="Created" value={dateShort(proof.createdAt)} />
        <Metric label="Shared data" value="Proof only" />
      </div>
      <PrivacyNotice compact />
    </section>
  );
}

export function ProofBadge({ proof, label }: { proof?: Proof; label?: string }) {
  const approved = !proof || proof.status === "Tenant Verified";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ring-1 ${
        approved ? "bg-verified-50 text-verified-700 ring-verified-100" : "bg-rose-50 text-rose-700 ring-rose-100"
      }`}
    >
      {approved ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      {label ?? (approved ? "Verified proof" : "Not verified")}
    </span>
  );
}

export function LandlordDashboard({
  rows,
  onAccept,
  onReject,
}: {
  rows: Array<{ application: Application; proof?: Proof; property?: Property }>;
  onAccept: (applicationId: string) => void | Promise<{ ok: boolean; message: string } | undefined>;
  onReject: (applicationId: string) => void;
}) {
  const [verificationByProofId, setVerificationByProofId] = useState<Record<string, ProofVerificationResult>>({});
  const [verificationUnavailableByProofId, setVerificationUnavailableByProofId] = useState<Record<string, string>>({});
  const [acceptLoadingByApplicationId, setAcceptLoadingByApplicationId] = useState<Record<string, boolean>>({});
  const [acceptMessageByApplicationId, setAcceptMessageByApplicationId] = useState<Record<string, string>>({});
  const [acceptErrorByApplicationId, setAcceptErrorByApplicationId] = useState<Record<string, string>>({});

  useEffect(() => {
    rows.forEach(({ proof }) => {
      if (!proof) return;
      const proofId = proof.proofId || proof.id;
      verifyProofBackend(proof).then(({ verification }) => {
        setVerificationByProofId((current) => ({ ...current, [proofId]: verification }));
        setVerificationUnavailableByProofId((current) => {
          const next = { ...current };
          delete next[proofId];
          return next;
        });
      }).catch(() => {
        setVerificationUnavailableByProofId((current) => ({ ...current, [proofId]: "Backend verification failed." }));
      });
    });
  }, [rows]);

  const runAccept = async (applicationId: string) => {
    setAcceptLoadingByApplicationId((current) => ({ ...current, [applicationId]: true }));
    setAcceptMessageByApplicationId((current) => {
      const next = { ...current };
      delete next[applicationId];
      return next;
    });
    setAcceptErrorByApplicationId((current) => {
      const next = { ...current };
      delete next[applicationId];
      return next;
    });

    try {
      const result = await onAccept(applicationId);
      if (result?.ok) {
        setAcceptMessageByApplicationId((current) => ({ ...current, [applicationId]: result.message }));
      } else {
        setAcceptErrorByApplicationId((current) => ({
          ...current,
          [applicationId]: result?.message ?? "Backend verification failed.",
        }));
      }
    } catch (error) {
      setAcceptErrorByApplicationId((current) => ({
        ...current,
        [applicationId]: error instanceof Error ? error.message : "Backend verification failed.",
      }));
    } finally {
      setAcceptLoadingByApplicationId((current) => ({ ...current, [applicationId]: false }));
    }
  };

  if (rows.length === 0) return <EmptyState />;

  return (
    <div className="grid gap-5">
      {rows.map(({ application, proof, property }) => (
        <article key={application.id} className="card p-5 md:p-6">
          {(() => {
            const backendVerification = proof ? verificationByProofId[proof.proofId || proof.id] : undefined;
            const backendValid = isBackendAcceptedForLandlord(backendVerification);
            const unavailableReason = proof ? verificationUnavailableByProofId[proof.proofId || proof.id] : undefined;
            const verificationUnavailable = Boolean(proof && (!backendVerification || unavailableReason));
            const acceptLoading = Boolean(acceptLoadingByApplicationId[application.id]);
            const acceptMessage = acceptMessageByApplicationId[application.id];
            const acceptError = acceptErrorByApplicationId[application.id];
            return (
          <>
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold text-navy-950">{property?.title ?? "Unknown property"}</h2>
                <ApplicationStatusBadge status={application.status} />
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-500">Application {application.id}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link to={`/landlord/application/${application.id}`}>
                <Button className="w-full sm:w-auto">Review application</Button>
              </Link>
              <Button className="w-full sm:w-auto" onClick={() => runAccept(application.id)} disabled={application.status === "accepted" || !proof || acceptLoading}>
                {acceptLoading ? "Verifying proof..." : "Accept"}
              </Button>
              <Button variant="danger" className="w-full sm:w-auto" onClick={() => onReject(application.id)} disabled={application.status === "rejected"}>
                Reject
              </Button>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Property" value={property?.title ?? application.propertyId} />
            <Metric
              label="Tenant proof"
              value={
                proof
                  ? <BackendVerificationBadge verification={backendVerification} unavailable={verificationUnavailable} />
                  : <Badge tone="rose">Missing proof</Badge>
              }
            />
            <Metric label="Rent range" value={proof ? `$${proof.compatibleRentRange.min}-$${proof.compatibleRentRange.max}` : "Unavailable"} />
            <Metric label="Risk category" value={proof ? <RiskBadge risk={proof.riskCategory} /> : <Badge tone="slate">No risk</Badge>} />
            <Metric
              label="Attestation state"
              value={
                backendValid
                  ? <Badge tone="green">Trusted issuer verified</Badge>
                  : verificationUnavailable
                    ? <Badge tone="amber">Verification unavailable</Badge>
                    : <Badge tone="rose">{unavailableReason ?? backendVerification?.reason ?? "Backend rejected"}</Badge>
              }
            />
            <Metric
              label="Execution mode"
              value={isSimulationOnlyProof(proof) ? <Badge tone="amber">Simulation only</Badge> : <Badge tone="green">Backend issued</Badge>}
            />
            <Metric label="Proof ID" value={proof?.id ?? application.proofId} />
            <Metric label="Valid until" value={proof ? dateShort(proof.expiresAt) : "Unavailable"} />
            <Metric label="Submitted" value={dateTimeShort(application.submittedAt)} />
          </div>
          <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-500">
            Raw income, expenses, savings, debt, and bank statements are never shown to the landlord. Only the reusable proof is shared.
          </p>
          {acceptLoading ? (
            <p className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800">
              Verifying proof...
            </p>
          ) : null}
          {acceptMessage ? (
            <p className="mt-5 rounded-2xl border border-verified-100 bg-verified-50 p-4 text-sm font-bold text-verified-700">
              {acceptMessage}
            </p>
          ) : null}
          {acceptError ? (
            <p className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
              {acceptError}
            </p>
          ) : null}
          </>
            );
          })()}
        </article>
      ))}
    </div>
  );
}

export function ApplicationReview({
  application,
  proof,
  property,
}: {
  application: Application;
  proof: Proof;
  property?: Property;
}) {
  return (
    <section className="card p-6 md:p-8">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
        <div>
          <Badge tone="navy">Application review</Badge>
          <h1 className="mt-4 text-4xl font-bold text-navy-950">{property?.title ?? "Rental application"}</h1>
          <p className="mt-3 max-w-2xl text-slate-600">Review tenant eligibility without accessing private financial records.</p>
        </div>
        <ApplicationStatusBadge status={application.status} />
      </div>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Tenant" value={proof.status === "Tenant Verified" ? "Tenant Verified" : "Not Verified"} />
        <Metric label="Compatible rent" value={`$${proof.compatibleRentRange.min}-$${proof.compatibleRentRange.max}`} />
        <Metric label="Risk category" value={<RiskBadge risk={proof.riskCategory} />} />
        <Metric label="Attestation" value={proof.attestationStatus === "attested" ? "Attested" : "Failed"} />
        <Metric label="Proof ID" value={proof.id} />
        <Metric label="Tenant wallet" value={proof.tenantWallet} />
        <Metric label="Valid until" value={dateShort(proof.expiresAt)} />
        <Metric label="Submitted" value={dateTimeShort(application.submittedAt)} />
        <Metric label="Contact" value={application.contactUnlocked ? "Unlocked" : "Locked"} />
      </div>
      <PrivacyNotice compact />
    </section>
  );
}

export function MutualRevealPanel({
  unlocked,
  handoffMethod,
}: {
  unlocked: boolean;
  handoffMethod?: string;
}) {
  return (
    <section className={`rounded-2xl border p-5 ${unlocked ? "border-verified-100 bg-verified-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${unlocked ? "bg-verified-100 text-verified-700" : "bg-white text-slate-500"}`}>
          {unlocked ? <KeyRound className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-navy-950">{unlocked ? "Contact unlocked" : "Mutual Reveal"}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {unlocked
              ? handoffMethod
                ? `Handoff scheduled via ${handoffMethod}.`
                : "Contact details are available after landlord acceptance."
              : "Contact details are locked until landlord approval."}
          </p>
        </div>
      </div>
    </section>
  );
}

export function PrivacyNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-slate-50 ${compact ? "mt-5 p-4" : "p-5"}`}>
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-verified-700" />
        <div className="grid gap-2 text-sm font-semibold leading-6 text-slate-500 sm:grid-cols-2">
          {PRIVACY_REMINDERS.map((reminder) => (
            <p key={reminder}>{reminder}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StepIndicator({ currentStep, steps }: { currentStep: number; steps: string[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => {
        const active = index + 1 <= currentStep;
        return (
          <li key={step} className={`rounded-2xl border p-4 shadow-card ${active ? "border-verified-100 bg-verified-50" : "border-slate-200 bg-white"}`}>
            <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-verified-600 text-white" : "bg-slate-100 text-slate-400"}`}>
              {index + 1}
            </span>
            <p className="mt-3 text-sm font-bold text-navy-950">{step}</p>
          </li>
        );
      })}
    </ol>
  );
}

function ApplicationStatusBadge({ status }: { status: Application["status"] }) {
  const tone: Tone = status === "accepted" ? "green" : status === "rejected" ? "rose" : "amber";
  return <Badge tone={tone}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className="mt-2 break-words text-sm font-bold text-navy-950">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <Building2 className="mx-auto h-10 w-10 text-verified-600" />
      <h2 className="mt-4 text-2xl font-bold text-navy-950">No applications yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        Generate a tenant proof from a property page to populate this dashboard. The landlord view will show proof status only.
      </p>
    </div>
  );
}
