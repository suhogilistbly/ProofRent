import {
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  DatabaseZap,
  EyeOff,
  ExternalLink,
  FileCheck2,
  Home,
  KeyRound,
  Layers3,
  Link2,
  Lock,
  MapPin,
  RefreshCcw,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Stamp,
  UserRoundCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnimatePresence, motion } from "framer-motion";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
  ensureSeedData,
  findApplication,
  findProof,
  findProperty,
  getApplications,
  getProofs,
  getProperties,
  isProofCompatibleWithRent,
  revokeStoredProof,
  saveApplications,
  saveProofs,
} from "./data";
import {
  HeroSection,
  LandlordDashboard,
  Navbar,
  PrivacyNotice as SharedPrivacyNotice,
  ProofBadge,
  PropertyCard as ReusablePropertyCard,
  BackendVerificationBadge,
  isBackendAcceptedForLandlord,
  isSimulationOnlyProof,
} from "./components";
import { createApplication, generateDemoSignedProofWithProviders, generateProofWithProviders } from "./proofEngine";
import {
  createProofRequestMessage,
  createRequestNonce,
  createProtectedTenantPayload,
  signProofRequest,
} from "./proof/proofExecution";
import { verifyProofAuthenticity } from "./proofCrypto";
import {
  getMagicBlockBackendStatus,
  getPublicProof,
  issueProof as issueProofEndpoint,
  revokeProof as revokeProofEndpoint,
  testMagicBlockPERAdapter,
  verifyProof as verifyProofBackend,
  type ProofIssueRequest,
  type ProofVerificationResult as BackendProofVerificationResult,
} from "./proofApi";
import {
  ProofChecksList,
  ProofDetailsGrid,
  ProofPrivacyText,
  ProofStatusHeader,
  ProofSummary,
  approvedCheckLabels,
  rejectedCheckLabels,
} from "./proofComponents";
import { ArchitecturePage, LifecyclePage, SecurityPage } from "./technicalPages";
import type { PrivateFinancialProfile } from "./proofEngine";
import type { Application, Proof, Property } from "./types";
import { Badge, Button, PrivacyPanel, RiskBadge, StatusBadge, currency, dateShort, dateTimeShort } from "./ui";
import { getMagicBlockConfigStatus, magicBlockConfig, MAGICBLOCK_SIMULATION_MESSAGE } from "./magicblock/magicblockConfig";
import { createMagicBlockWalletChallenge, getStoredAccessToken, requestMagicBlockAccessToken } from "./magicblock/accessTokenClient";
import { requestMagicBlockAttestation } from "./magicblock/attestationClient";
import { EXECUTION_PUBLIC_KEY, getEncryptionMode, PLAINTEXT_DEMO_MESSAGE } from "./crypto/encryption";

function useSeededData() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);

  const refresh = () => {
    setProperties(getProperties());
    setProofs(getProofs());
    setApplications(getApplications());
  };

  useEffect(() => {
    ensureSeedData();
    refresh();
  }, []);

  return { properties, proofs, applications, refresh };
}

const hasVerifiedMagicBlockPER = (proof?: Proof) =>
  proof?.executionMetadata?.provider === "magicblock-per" &&
  proof.executionMetadata.attestationVerified === true;

const verificationProgressMessages = [
  "Submitting protected payload to execution service...",
  "Verifying income-to-rent ratio...",
  "Checking cashflow stability...",
  "Checking emergency buffer...",
  "Calculating tenant risk score...",
  "Issuing privacy-preserving Rental Passport...",
] as const;

const solanaDevnetExplorerUrl = (signature?: string) =>
  signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined;

const isLocallyAcceptedForLandlord = (proof?: Proof | null) => {
  if (!proof || proof.status !== "Tenant Verified") return false;
  const verification = verifyProofAuthenticity(proof);
  return verification.valid && verification.signatureValid && verification.integrityValid && !verification.expired && !verification.revoked;
};

const canAcceptForLandlord = (proof?: Proof | null, verification?: BackendProofVerificationResult | null) =>
  Boolean(proof && isBackendAcceptedForLandlord(verification));

const verificationDiagnosticsText = (verification?: BackendProofVerificationResult | null) => {
  if (!verification) return "Verification unavailable";
  const details = verification.integrityDiagnostics;
  return [
    ...verification.diagnostics,
    `expectedHash=${details.expectedHash}`,
    `actualHash=${details.actualHash}`,
    details.mismatchedFields.length ? `mismatchedFields=${details.mismatchedFields.join("|")}` : undefined,
    `signedPayloadKeys=${details.signedPayloadKeys.join("|")}`,
    `receivedPayloadKeys=${details.receivedPayloadKeys.join("|")}`,
  ].filter(Boolean).join(", ");
};

const ACCEPT_SUCCESS_MESSAGE = "Applicant accepted";
const BACKEND_UNAVAILABLE_MESSAGE = "Backend verification unavailable";

type AcceptResult = {
  ok: boolean;
  message: string;
  application?: Application;
  verification?: BackendProofVerificationResult;
};

const backendVerificationErrorMessage = (error: unknown) => {
  if (error instanceof TypeError) return BACKEND_UNAVAILABLE_MESSAGE;
  if (error instanceof Error && /failed to fetch|network|load failed|api request failed with 404/i.test(error.message)) {
    return BACKEND_UNAVAILABLE_MESSAGE;
  }
  return error instanceof Error ? error.message : "Backend verification failed.";
};

const verifyAndAcceptApplication = async (
  application: Application,
  proof: Proof,
): Promise<AcceptResult> => {
  if (!isLocallyAcceptedForLandlord(proof)) {
    return {
      ok: false,
      message: "Proof is not valid for landlord acceptance.",
    };
  }

  try {
    const { verification } = await verifyProofBackend(proof);
    if (!canAcceptForLandlord(proof, verification)) {
      return {
        ok: false,
        message: verification.reason,
        verification,
      };
    }

    return {
      ok: true,
      message: ACCEPT_SUCCESS_MESSAGE,
      application: acceptApplication(application.id, true),
      verification,
    };
  } catch (error) {
    return {
      ok: false,
      message: backendVerificationErrorMessage(error),
    };
  }
};

function SolanaTransactionLink({ proof }: { proof: Proof }) {
  const signature = proof.solanaTxSignature ?? proof.onChainCommitment?.transactionSignature;
  const explorerUrl = solanaDevnetExplorerUrl(signature);

  if (!signature || !explorerUrl) return <>Unavailable</>;

  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 break-all text-verified-700 hover:text-verified-800"
    >
      {signature}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <Navbar />
      {children}
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-navy-950"
    >
      {children}
    </Link>
  );
}

function HomePage() {
  const { properties, proofs } = useSeededData();
  const latestProof = proofs[0];
  const demoProperty = properties[0]?.id ?? "modern-studio-apartment";

  return (
    <Layout>
      <main>
        <HeroSection latestProof={latestProof} demoPropertyId={demoProperty} />
        <section className="container-page py-10">
          <TechnicalHomeLinks />
        </section>
        <section className="container-page py-14">
          <FounderGradeProofSection />
        </section>
        <section className="container-page pb-14">
          <PrivacyProblemSection />
        </section>
        <section className="container-page py-14">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-700">How it works</p>
              <h2 className="mt-3 text-3xl font-bold text-navy-950">A tenant journey built around privacy</h2>
            </div>
          </div>
          <div className="mt-7 grid gap-5 md:grid-cols-5">
            {[
              ["Tenant connects financial source", DatabaseZap],
              ["Data stays out of landlord view", Lock],
              ["Proof is generated", FileCheck2],
              ["Landlord reviews only the proof", ShieldCheck],
              ["Contact is unlocked only after acceptance", KeyRound],
            ].map(([title, Icon], index) => {
              const CardIcon = Icon as typeof DatabaseZap;
              return (
                <div key={title as string} className="card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <CardIcon className="h-6 w-6 text-verified-600" />
                    <span className="text-sm font-bold text-slate-400">{index + 1}</span>
                  </div>
                  <h3 className="mt-5 text-base font-bold leading-6">{title as string}</h3>
                </div>
              );
            })}
          </div>
        </section>
        <section className="container-page pb-14">
          <PERExecutionFlow />
        </section>
        <section className="container-page pb-14">
          <SolanaArchitectureSection />
        </section>
        <section className="container-page pb-14">
          <ProofLifecycleVisualization />
        </section>
        <section className="container-page pb-14">
          <div className="grid gap-6 lg:grid-cols-2">
            <WalletSigningVisualization />
            <AttestationVerificationVisualization />
          </div>
        </section>
        <section className="container-page pb-14">
          <ThreatModelSection />
        </section>
        <section className="container-page pb-14">
          <InteractiveProofVerificationDemo latestProof={latestProof} demoPropertyId={demoProperty} />
        </section>
        <section className="container-page pb-14">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl bg-navy-950 p-7 text-white shadow-soft">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-100">Why this matters</p>
              <p className="mt-5 text-2xl font-bold leading-9">
                Renters should not have to reveal their full financial life just to apply for housing. Landlords still need trust. ProofRent creates trust without surveillance.
              </p>
            </div>
            <div className="rounded-2xl border border-verified-100 bg-verified-50 p-7">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-700">Reusable private proofs</p>
              <h2 className="mt-4 text-3xl font-bold leading-tight text-navy-950">
                ProofRent replaces sensitive rental documents with reusable private proofs of tenant reliability.
              </h2>
            </div>
          </div>
        </section>
        <section className="container-page pb-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-700">Featured homes</p>
              <h2 className="mt-3 text-3xl font-bold text-navy-950">Apply with a privacy proof</h2>
            </div>
            <Link to="/properties" className="hidden text-sm font-bold text-navy-950 md:inline-flex">
              View all properties
            </Link>
          </div>
          <PropertyGrid properties={properties.slice(0, 3)} />
        </section>
      </main>
    </Layout>
  );
}

function TechnicalHomeLinks() {
  const links = [
    ["Architecture", "/architecture", "Execution design", Layers3],
    ["Security", "/security", "Threat model", ShieldCheck],
    ["Lifecycle", "/lifecycle", "Proof flow", RefreshCcw],
  ] as const;

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {links.map(([title, to, label, Icon]) => (
        <Link
          key={title}
          to={to}
          className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-verified-200 hover:shadow-soft"
        >
          <span className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-verified-700 transition group-hover:bg-verified-50">
              <Icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-bold text-navy-950">{title}</span>
              <span className="mt-1 block text-sm font-semibold text-slate-500">{label}</span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-verified-700" />
        </Link>
      ))}
    </section>
  );
}

function FounderGradeProofSection() {
  return (
    <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
      <div className="rounded-2xl bg-white p-7 shadow-card ring-1 ring-slate-200">
        <Badge tone="green">Built for the MagicBlock Privacy Track</Badge>
        <h2 className="mt-4 text-3xl font-bold leading-tight text-navy-950">A privacy protocol hiding inside a rental application people already understand.</h2>
        <p className="mt-4 text-base leading-7 text-slate-600">
          ProofRent converts high-friction document review into reusable, wallet-bound rental proofs. Tenants keep sensitive records private, landlords keep a credible trust signal, and Solana becomes the verification surface instead of a PDF inbox.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {["Solana wallet consent", "Reusable proof passport", "Attestation-ready execution", "Selective landlord disclosure"].map((item) => (
            <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Tenant data exposed", "0 raw fields", EyeOff],
          ["Proof reuse window", "30 days", RefreshCcw],
          ["Verifier surface", "Solana-native", ShieldCheck],
        ].map(([label, value, Icon]) => {
          const MetricIcon = Icon as typeof EyeOff;
          return (
            <div key={label as string} className="rounded-2xl border border-slate-200 bg-navy-950 p-5 text-white shadow-card">
              <MetricIcon className="h-6 w-6 text-verified-100" />
              <p className="mt-8 text-sm font-semibold text-slate-400">{label as string}</p>
              <p className="mt-2 text-3xl font-bold">{value as string}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PrivacyProblemSection() {
  const points = [
    {
      title: "Rental applications overshare data",
      body: "Most applications ask for bank statements, payroll screenshots, IDs, and employer details even when the real question is whether the applicant can reliably pay a specific rent.",
      icon: DatabaseZap,
    },
    {
      title: "PDFs are dangerous",
      body: "PDF packets are copied, forwarded, stored indefinitely, and reviewed by people who do not need the underlying account history.",
      icon: FileCheck2,
    },
    {
      title: "Reusable proofs matter",
      body: "Renters should not repeat the same exposure for every listing. A signed, revocable proof lets one eligibility check travel across compatible homes.",
      icon: RefreshCcw,
    },
    {
      title: "Landlords still need trust",
      body: "Privacy cannot mean blind acceptance. Landlords need validity, risk, rent compatibility, expiry, and attestation status they can independently verify.",
      icon: Building2,
    },
    {
      title: "Confidential execution changes the default",
      body: "Instead of handing raw data to every landlord, a private execution boundary computes the answer and exports only the minimal proof surface.",
      icon: Layers3,
    },
  ];

  return (
    <section>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-700">Why now</p>
          <h2 className="mt-3 text-3xl font-bold text-navy-950">Housing applications need privacy without losing verifiability.</h2>
        </div>
      </div>
      <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {points.map((point) => {
          const PointIcon = point.icon;
          return (
            <article key={point.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
              <PointIcon className="h-6 w-6 text-verified-700" />
              <h3 className="mt-5 text-lg font-bold leading-6 text-navy-950">{point.title}</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{point.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SolanaArchitectureSection() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <Badge tone="navy">Technical architecture</Badge>
          <h2 className="mt-4 text-3xl font-bold text-navy-950">Powered by Solana + MagicBlock-compatible confidential execution</h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            The MVP keeps the architecture honest: wallet signatures, proof hashing, attestation metadata, revocation state, and verifier UX are implemented now; production confidential execution would swap the local adapter for MagicBlock PER-backed private state transitions.
          </p>
        </div>
      </div>
      <div className="mt-7 grid gap-4 lg:grid-cols-4">
        {[
          ["Wallet consent", "Tenant signs a proof request with a Solana wallet before private evaluation starts.", WalletCards],
          ["Confidential adapter", "A MagicBlock-compatible execution boundary computes eligibility from protected tenant inputs.", ServerCog],
          ["Signed proof", "Sanitized proof fields are hashed, signed, time-boxed, and reusable across compatible listings.", Stamp],
          ["Verifier surface", "Landlords validate signatures, expiry, proof hash, attestation metadata, and revocation status.", ShieldCheck],
        ].map(([title, body, Icon]) => {
          const ArchitectureIcon = Icon as typeof WalletCards;
          return (
            <div key={title as string} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <ArchitectureIcon className="h-6 w-6 text-verified-700" />
              <h3 className="mt-4 font-bold text-navy-950">{title as string}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body as string}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProofLifecycleVisualization() {
  const steps = [
    ["Private inputs", "Income, expenses, savings, debt, and target rent are prepared as protected tenant payload material.", Lock],
    ["Wallet-bound request", "Tenant signs consent and binds the computation to a Solana wallet.", WalletCards],
    ["Confidential execution", "Eligibility policy runs inside the simulated MagicBlock-compatible execution boundary.", Layers3],
    ["Reusable proof", "The result becomes a signed rental passport with compatibility range and expiry.", FileCheck2],
    ["Landlord verification", "Verifier checks signature, proof hash, attestation metadata, expiry, and revocation state.", ShieldCheck],
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
      <Badge tone="green">Proof lifecycle visualization</Badge>
      <h2 className="mt-4 text-3xl font-bold text-navy-950">A proof can be generated once, reused many times, and revoked when needed.</h2>
      <div className="mt-7 grid gap-3 lg:grid-cols-5">
        {steps.map(([title, body, Icon], index) => {
          const StepIcon = Icon as typeof Lock;
          return (
            <div key={title as string} className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-verified-700 shadow-card">
                  <StepIcon className="h-5 w-5" />
                </span>
                <span className="text-sm font-bold text-slate-400">0{index + 1}</span>
              </div>
              <h3 className="mt-5 font-bold text-navy-950">{title as string}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body as string}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WalletSigningVisualization() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
      <Badge tone="navy">Wallet signing visualization</Badge>
      <h2 className="mt-4 text-2xl font-bold text-navy-950">Tenant signs the request, not a document dump.</h2>
      <div className="mt-6 grid gap-3">
        {[
          ["Request", "propertyId + rent + payload commitment + nonce", FileCheck2],
          ["Wallet", "Ed25519 request signature from tenant wallet", WalletCards],
          ["Execution", "signed request accepted by confidential adapter", ServerCog],
        ].map(([title, body, Icon]) => {
          const SigningIcon = Icon as typeof FileCheck2;
          return (
            <div key={title as string} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <SigningIcon className="h-5 w-5 shrink-0 text-verified-700" />
              <div>
                <p className="font-bold text-navy-950">{title as string}</p>
                <p className="mt-1 text-sm font-semibold text-slate-600">{body as string}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AttestationVerificationVisualization() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
      <Badge tone="green">Attestation verification visualization</Badge>
      <h2 className="mt-4 text-2xl font-bold text-navy-950">Landlords verify the proof boundary, not the tenant ledger.</h2>
      <div className="mt-6 grid gap-3">
        {[
          ["Proof hash", "matches attested execution result", CheckCircle2],
          ["Attestation signature", "binds issuer, environment, expiry, and proofHash", Stamp],
          ["Public verifier", "checks integrity, expiry, revocation, and signatures", ShieldCheck],
        ].map(([title, body, Icon]) => {
          const AttestationIcon = Icon as typeof CheckCircle2;
          return (
            <div key={title as string} className="flex items-center gap-4 rounded-2xl border border-verified-100 bg-verified-50 p-4">
              <AttestationIcon className="h-5 w-5 shrink-0 text-verified-700" />
              <div>
                <p className="font-bold text-navy-950">{title as string}</p>
                <p className="mt-1 text-sm font-semibold text-slate-600">{body as string}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ThreatModelSection() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-navy-950 p-6 text-white shadow-soft md:p-8">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
        <div>
          <Badge tone="green">Threat model</Badge>
          <h2 className="mt-4 text-3xl font-bold">What ProofRent protects, and what the MVP states clearly.</h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
            The product is designed to reduce document leakage, landlord over-collection, proof tampering, replay risk, and stale approvals while staying explicit that production private runtime guarantees require MagicBlock PER integration.
          </p>
        </div>
      </div>
      <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          ["Protected", "Raw financial values, provider records, bank PDFs, and tenant contact details before landlord approval."],
          ["Verified", "Wallet signature, proof signature, proof hash, attestation signature, expiry, and revocation state."],
          ["Residual risk", "Metadata such as proof creation time, compatible rent range, and risk tier remain intentionally visible."],
          ["Production upgrade", "Replace local adapter with MagicBlock PER jobs, execution keys, runtime evidence, and on-chain verifier state."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="font-bold">{title}</h3>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function InteractiveProofVerificationDemo({
  latestProof,
  demoPropertyId,
}: {
  latestProof?: Proof;
  demoPropertyId: string;
}) {
  const [generatedProof, setGeneratedProof] = useState<Proof | null>(null);
  const [tampered, setTampered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const baseProof = generatedProof ?? latestProof ?? null;
  const proofForVerification =
    baseProof && tampered
      ? {
          ...baseProof,
          compatibleRentRange: {
            ...baseProof.compatibleRentRange,
            max: baseProof.compatibleRentRange.max + 500,
          },
        }
      : baseProof;
  const verification = proofForVerification ? verifyProofAuthenticity(proofForVerification) : null;

  const createDemoProof = async () => {
    setLoading(true);
    setError("");
    try {
      const property = findProperty(demoPropertyId);
      if (!property) throw new Error("Demo property is unavailable.");
      const nextProof = await generateDemoSignedProofWithProviders(property.id, property.rent, strongDemoProfile);
      setGeneratedProof(nextProof);
      setTampered(false);
    } catch (event) {
      setError(event instanceof Error ? event.message : "Could not generate demo proof.");
    } finally {
      setLoading(false);
    }
  };

  const checks = verification
    ? [
        ["Integrity", verification.integrityValid],
        ["Proof signature", verification.signatureValid],
        ["Proof hash", verification.proofHashValid],
        ["Attestation signature", verification.attestationSignatureValid],
        ["Not expired", !verification.expired && !verification.attestationExpired],
      ]
    : [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card md:p-8">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div>
          <Badge tone="green">Interactive proof verification demo</Badge>
          <h2 className="mt-4 text-3xl font-bold text-navy-950">Show judges a valid proof, then tamper with it live.</h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            The verifier recomputes integrity, Ed25519 signatures, proof hash consistency, attestation signature, expiry, and revocation state. Changing a public field breaks the proof.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={createDemoProof} disabled={loading}>
            {loading ? "Generating..." : "Generate demo proof"} <FileCheck2 className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => setTampered((current) => !current)} disabled={!baseProof}>
            {tampered ? "Restore proof" : "Tamper with proof"} <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {error ? <p className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</p> : null}
      <div className="mt-7 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className={`rounded-2xl border p-5 ${verification?.valid ? "border-verified-100 bg-verified-50" : "border-slate-200 bg-slate-50"}`}>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Verifier decision</p>
          <h3 className="mt-3 text-3xl font-bold text-navy-950">{verification ? (verification.valid ? "Proof verified" : "Proof rejected") : "No proof loaded"}</h3>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            {verification?.reason ?? "Use the generator or create a proof elsewhere in the app to populate this panel."}
          </p>
          <div className="mt-5 grid gap-3">
            <ApplicationDetail label="Proof ID" value={proofForVerification?.id ?? "Pending"} />
            <ApplicationDetail label="Visible rent range" value={proofForVerification ? rentRangeLabel(proofForVerification) : "Pending"} />
            <ApplicationDetail label="Raw data exposure" value="None" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {checks.map(([label, passed]) => (
            <div key={label as string} className={`rounded-2xl border p-4 ${passed ? "border-verified-100 bg-verified-50" : "border-rose-100 bg-rose-50"}`}>
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${passed ? "bg-verified-100 text-verified-700" : "bg-rose-100 text-rose-700"}`}>
                {passed ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              </div>
              <p className="mt-3 text-sm font-bold text-navy-950">{label as string}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PropertyGrid({ properties }: { properties: Property[] }) {
  return (
    <div className="mt-7 grid gap-6 md:grid-cols-3">
      {properties.map((property) => (
        <ReusablePropertyCard key={property.id} property={property} />
      ))}
    </div>
  );
}

function PropertiesPage() {
  const { properties } = useSeededData();
  return (
    <Layout>
      <main className="container-page py-12">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Badge tone="green">Privacy-first listings</Badge>
            <h1 className="mt-4 text-4xl font-bold text-navy-950">Properties accepting ProofRent</h1>
            <p className="mt-3 max-w-2xl text-slate-600">Browse homes where you can apply privately with a reusable proof instead of bank statements or sensitive documents.</p>
          </div>
          <PrivacySeal />
        </div>
        <PropertyGrid properties={properties} />
      </main>
    </Layout>
  );
}

function PrivacySeal() {
  return (
    <div className="inline-flex items-center gap-3 rounded-2xl border border-verified-100 bg-verified-50 px-4 py-3 text-sm font-semibold text-verified-700">
      <Lock className="h-5 w-5" /> Raw financial data blocked
    </div>
  );
}

const demoPropertyId = "modern-studio-apartment";

const rentRangeLabel = (proof: Proof) =>
  `${currency(proof.compatibleRentRange.min)}-${currency(proof.compatibleRentRange.max)}/month`;

const validityLabel = (proof: Proof) => {
  if (proof.validity === "revoked" || proof.revokedAt) return "Revoked";
  if (Date.parse(proof.expiresAt) <= Date.now()) return "Expired";
  return "Active";
};

const encodeProofPayload = (proof: Proof) =>
  btoa(encodeURIComponent(JSON.stringify(proof)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const decodeProofPayload = (value?: string | null): Proof | undefined => {
  if (!value) return undefined;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(decodeURIComponent(atob(padded))) as Proof;
  } catch {
    return undefined;
  }
};

const publicProofUrl = (proof: Proof) =>
  `${window.location.origin}/verify-proof/${proof.proofId || proof.id}?proof=${encodeProofPayload(proof)}`;

const queueLandlordApplication = (propertyId: string, proofId: string) => {
  const existingApplication = getApplications().find(
    (application) => application.propertyId === propertyId && application.proofId === proofId,
  );
  if (existingApplication) return existingApplication;

  const nextApplication = createApplication(propertyId, proofId);
  saveApplications([nextApplication, ...getApplications()]);
  return nextApplication;
};

const strongDemoProfile: PrivateFinancialProfile = {
  monthlyIncome: 4200,
  monthlyExpenses: 1500,
  savings: 6000,
  monthlyDebt: 400,
};

function DemoPage() {
  const navigate = useNavigate();
  const property = findProperty(demoPropertyId);
  const [step, setStep] = useState(1);
  const [proof, setProof] = useState<Proof | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [autoWalkthrough, setAutoWalkthrough] = useState(false);
  const [demoError, setDemoError] = useState("");

  if (!property) return <Navigate to="/properties" replace />;

  const generateDemoProof = () => {
    setDemoError("");
    setStep(4);
    window.setTimeout(async () => {
      try {
        const nextProof = await generateDemoSignedProofWithProviders(property.id, property.rent, strongDemoProfile);
        saveProofs([nextProof, ...getProofs()]);
        setProof(nextProof);
        setStep(5);
      } catch (error) {
        setDemoError(error instanceof Error ? error.message : "Demo proof generation failed.");
        setAutoWalkthrough(false);
        setStep(3);
      }
    }, 2600);
  };

  const submitDemoApplication = () => {
    if (!proof) return;
    const nextApplication = queueLandlordApplication(property.id, proof.id);
    setApplication(nextApplication);
    setStep(6);
  };

  const openLandlordReview = () => {
    if (application) {
      navigate(`/landlord/application/${application.id}?demo=accept`);
    }
  };

  useEffect(() => {
    if (!autoWalkthrough) return;

    const timeout = window.setTimeout(() => {
      if (step < 3) {
        setStep(step + 1);
      } else if (step === 3) {
        generateDemoProof();
      } else if (step === 5 && proof) {
        submitDemoApplication();
      } else if (step === 6 && application) {
        openLandlordReview();
      }
    }, step === 4 ? 3200 : 1400);

    return () => window.clearTimeout(timeout);
  }, [application, autoWalkthrough, proof, step]);

  return (
    <Layout>
      <main className="container-page py-10">
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Badge tone="green">Guided demo mode</Badge>
            <h1 className="mt-4 text-4xl font-bold text-navy-950">Ideal ProofRent application flow</h1>
            <p className="mt-3 max-w-2xl text-slate-600">
              Follow a prefilled renter journey from private data input through proof-only landlord review and post-acceptance contact reveal.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:items-center">
            <Button variant={autoWalkthrough ? "primary" : "secondary"} onClick={() => setAutoWalkthrough((current) => !current)}>
              {autoWalkthrough ? "Auto walkthrough on" : "Start auto walkthrough"} <Sparkles className="h-4 w-4" />
            </Button>
            <PrivacySeal />
          </div>
        </div>

        {demoError ? (
          <div className="mb-8 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
            Demo verification failed: {demoError}
          </div>
        ) : null}

        <div className="mb-8 grid gap-4 lg:grid-cols-4">
          {[
            ["Judge pace", autoWalkthrough ? "Hands-free" : "Manual"],
            ["Demo proof", proof ? "Generated" : "Ready"],
            ["Landlord view", application ? "Queued" : "Pending"],
            ["Raw data", "Hidden"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
              <p className="mt-2 text-lg font-bold text-navy-950">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-7 lg:grid-cols-[340px_1fr]">
          <DemoTimeline currentStep={step} />

          <section className="card overflow-hidden">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div key="demo-property" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="grid lg:grid-cols-[0.9fr_1.1fr]">
                  <img src={property.image} alt={property.title} className="h-full min-h-[360px] w-full object-cover" />
                  <div className="p-6 md:p-8">
                    <Badge tone="green">Selected listing</Badge>
                    <h2 className="mt-4 text-3xl font-bold text-navy-950">{property.title}</h2>
                    <p className="mt-2 text-2xl font-bold">{currency(property.rent)}/month</p>
                    <p className="mt-5 text-base leading-7 text-slate-600">{property.description}</p>
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Demo scenario</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                        The renter selects this $800 studio, then proves affordability without sending bank statements to the landlord.
                      </p>
                    </div>
                    <Button onClick={() => setStep(2)} className="mt-7">
                      Select apartment <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div key="demo-private-data" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="p-6 md:p-8">
                  <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                    <div>
                      <Badge tone="amber">Private tenant input</Badge>
                      <h2 className="mt-4 text-3xl font-bold text-navy-950">Strong demo profile is loaded privately</h2>
                      <p className="mt-3 max-w-2xl text-slate-600">
                        These values simulate connected payroll, bank and wallet signals. They are used for computation and do not appear in the landlord review.
                      </p>
                    </div>
                    <Lock className="h-9 w-9 text-verified-700" />
                  </div>
                  <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <ApplicationDetail label="monthlyIncome" value={currency(strongDemoProfile.monthlyIncome)} />
                    <ApplicationDetail label="monthlyExpenses" value={currency(strongDemoProfile.monthlyExpenses)} />
                    <ApplicationDetail label="savings" value={currency(strongDemoProfile.savings)} />
                    <ApplicationDetail label="monthlyDebt" value={currency(strongDemoProfile.monthlyDebt)} />
                  </div>
                  <div className="mt-7 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-verified-100 bg-verified-50 p-5">
                      <h3 className="font-bold text-navy-950">Private data input</h3>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                        The renter can inspect the private values before verification starts.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <h3 className="font-bold text-navy-950">Landlord visibility</h3>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                        These exact values are blocked from landlord pages.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => setStep(3)} className="mt-7">
                    Use strong demo profile <ShieldCheck className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div key="demo-confidential-ready" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="p-6 md:p-8">
                  <Badge tone="navy">Simulated confidential execution request</Badge>
                  <h2 className="mt-4 text-3xl font-bold text-navy-950">Run PER-ready verification</h2>
                  <p className="mt-3 max-w-2xl text-slate-600">
                    The local simulated confidential execution service evaluates affordability, cashflow, reserves and debt burden, then emits only a reusable signed proof.
                  </p>
                  <div className="mt-7 grid gap-4 md:grid-cols-4">
                    {Object.values(approvedCheckLabels).map((label) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <ShieldCheck className="h-5 w-5 text-verified-700" />
                        <p className="mt-3 text-sm font-bold leading-6 text-navy-950">{label}</p>
                      </div>
                    ))}
                  </div>
                  <Button onClick={generateDemoProof} className="mt-7">
                    Run simulated verification <Lock className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}

            {step === 4 && (
              <motion.div key="demo-running" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="p-6 md:p-8">
                <VerificationProgress onComplete={() => undefined} framed={false} />
              </motion.div>
            )}

              {step === 5 && proof && (
                <motion.div key="demo-proof" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="p-6 md:p-8">
                  <ProofStatusHeader proof={proof} title="Approved proof generated" subtitle="Tenant Verified" />
                  <ProofDetailsGrid
                    details={[
                      { label: "Proof ID", value: proof.id },
                      { label: "Risk Level", value: "Low" },
                      { label: "Shared with landlord", value: "Proof only" },
                      { label: "Raw data", value: "Not shared" },
                    ]}
                  />
                  <ProofChecksList checks={proof.checks} labels={approvedCheckLabels} />
                  <ProofPrivacyText />
                  <Button onClick={submitDemoApplication} className="mt-7">
                    Submit application <FileCheck2 className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}

              {step === 6 && application && proof && (
                <motion.div key="demo-submit" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="p-6 md:p-8">
                  <Badge tone="amber">Application submitted</Badge>
                  <h2 className="mt-4 text-3xl font-bold text-navy-950">Landlord receives only the proof</h2>
                  <p className="mt-3 max-w-2xl text-slate-600">
                    The application is pending. The next screen is the real landlord review page, where demo mode will accept the applicant and unlock contact details.
                  </p>
                  <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <ApplicationDetail label="Application" value={application.id} />
                    <ApplicationDetail label="Status" value={<ApplicationStatusBadge status={application.status} />} />
                    <ApplicationDetail label="Contact" value="Locked" />
                    <ApplicationDetail label="Proof ID" value={proof.id} />
                    <ApplicationDetail label="Tenant financial data" value="Hidden" />
                    <ApplicationDetail label="Landlord action" value="Review and accept" />
                  </div>
                  <Button onClick={openLandlordReview} className="mt-7">
                    Navigate to landlord review <ExternalLink className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </main>
    </Layout>
  );
}

function DemoTimeline({ currentStep }: { currentStep: number }) {
  const steps = [
    "Select $800 studio",
    "Load private profile",
    "Run simulated confidential execution",
    "Generate approved proof",
    "Submit application",
    "Landlord review",
    "Accept and unlock contact",
  ];

  return (
    <aside className="card p-5 lg:sticky lg:top-24 lg:self-start">
      <div className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-verified-700" />
        <h2 className="font-bold text-navy-950">Demo guide</h2>
      </div>
      <div className="mt-5 space-y-3">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const active = currentStep === stepNumber;
          const done = currentStep > stepNumber;
          return (
            <div
              key={label}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                active
                  ? "border-navy-950 bg-navy-950 text-white"
                  : done
                    ? "border-verified-100 bg-verified-50 text-verified-700"
                    : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${active ? "bg-white text-navy-950" : done ? "bg-verified-100" : "bg-white"}`}>
                {done ? <Check className="h-4 w-4" /> : stepNumber}
              </span>
              {label}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function PropertyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { proofs, refresh } = useSeededData();
  const property = findProperty(id);
  const compatibleProofs = property ? proofs.filter((proof) => isProofCompatibleWithRent(proof, property.rent)) : [];

  const reuseProof = (proof: Proof) => {
    if (!property) return;
    const nextApplication = queueLandlordApplication(property.id, proof.id);
    refresh();
    navigate(`/landlord/application/${nextApplication.id}`);
  };

  if (!property) return <Navigate to="/properties" replace />;

  return (
    <Layout>
      <main className="container-page grid gap-8 py-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <img src={property.image} alt={property.title} className="h-[420px] w-full rounded-2xl object-cover shadow-soft" />
          <div className="mt-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-700">{property.location}</p>
            <h1 className="mt-3 text-4xl font-bold text-navy-950">{property.title}</h1>
            <p className="mt-4 text-lg leading-8 text-slate-600">{property.description}</p>
          </div>
        </div>
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className="card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">Monthly rent</p>
                <p className="mt-1 text-3xl font-bold text-navy-950">{currency(property.rent)}</p>
              </div>
              <Building2 className="h-8 w-8 text-verified-600" />
            </div>
            <div className="mt-6 space-y-3">
              {property.requirements.map((requirement) => (
                <div key={requirement} className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-verified-600" /> {requirement}
                </div>
              ))}
            </div>
            <Link to={`/verify/${property.id}`} className="mt-7 block">
              <Button className="w-full">
                Create Rental Passport <ShieldCheck className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/tenant/passport" className="mt-3 block">
              <Button variant="secondary" className="w-full">
                Open passport dashboard <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          {compatibleProofs.length > 0 ? (
            <div className="card p-6">
              <Badge tone="green">Reusable proof available</Badge>
              <h2 className="mt-4 text-xl font-bold text-navy-950">Apply with a Privacy-preserving Rental Passport</h2>
              <div className="mt-5 grid gap-3">
                {compatibleProofs.map((proof) => (
                  <div key={proof.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div>
                        <p className="text-sm font-bold text-navy-950">{rentRangeLabel(proof)}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {proof.id} - {validityLabel(proof)} - {proof.attestationStatus === "attested" ? "Attested" : "Not attested"}
                        </p>
                      </div>
                      <Button onClick={() => reuseProof(proof)} className="w-full sm:w-auto">
                        Reuse proof <Link2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <PrivacyPanel />
        </aside>
      </main>
    </Layout>
  );
}

function VerifyPage() {
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const { publicKey, connected, signMessage } = useWallet();
  const property = findProperty(propertyId);
  const [step, setStep] = useState(1);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [profile, setProfile] = useState<PrivateFinancialProfile>({
    monthlyIncome: 0,
    monthlyExpenses: 0,
    savings: 0,
    monthlyDebt: 0,
  });
  const [proof, setProof] = useState<Proof | null>(null);
  const [magicBlockMessage, setMagicBlockMessage] = useState(() => getMagicBlockConfigStatus().message);
  const [magicBlockError, setMagicBlockError] = useState<string | null>(null);
  const encryptionMessage =
    getEncryptionMode() === "magicblock-encrypted"
      ? "Production MagicBlock PER mode: financial inputs are encrypted to the execution environment before submission."
      : PLAINTEXT_DEMO_MESSAGE;

  if (!property) return <Navigate to="/properties" replace />;

  const finishVerification = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setStep(2);
      return;
    }

    setMagicBlockError(null);
    try {
      const nextProof = await generateProofWithProviders(
        property.id,
        property.rent,
        profile,
        publicKey.toBase58(),
        signMessage,
      );
      setMagicBlockMessage(
        hasVerifiedMagicBlockPER(nextProof)
          ? "Executed via MagicBlock PER"
          : MAGICBLOCK_SIMULATION_MESSAGE,
      );
      saveProofs([nextProof, ...getProofs()]);
      if (nextProof.status === "Tenant Verified") {
        queueLandlordApplication(property.id, nextProof.id);
      }
      setProof(nextProof);
      setStep(5);
      navigate(`/tenant/result/${nextProof.id}`);
    } catch (error) {
      setMagicBlockError(error instanceof Error ? error.message : "Proof generation failed.");
      setStep(3);
    }
  }, [navigate, profile, property.id, property.rent, publicKey, signMessage]);

  return (
    <Layout>
      <main className="container-page py-12">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <Badge tone="green">Privacy-preserving Rental Passport</Badge>
              <h1 className="mt-4 text-4xl font-bold text-navy-950">Reusable tenant verification</h1>
              <p className="mt-3 max-w-2xl text-slate-600">
                Create one reusable passport that can be shared across compatible rental properties. Private values are used only during local proof computation and are never saved to the landlord view.
              </p>
              <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-800">
                {magicBlockMessage}
                {magicBlockError ? <span className="block text-rose-700">MagicBlock check failed: {magicBlockError}</span> : null}
              </div>
              <div
                className={`mt-3 rounded-2xl border p-4 text-sm font-bold leading-6 ${
                  getEncryptionMode() === "magicblock-encrypted"
                    ? "border-verified-100 bg-verified-50 text-verified-700"
                    : "border-amber-100 bg-amber-50 text-amber-800"
                }`}
              >
                {encryptionMessage}
              </div>
            </div>
            <PrivacySeal />
          </div>

          <StepIndicator currentStep={Math.min(step, 4)} />

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="property" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="card mt-8 overflow-hidden">
                <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
                  <img src={property.image} alt={property.title} className="h-full min-h-[320px] w-full object-cover" />
                  <div className="p-6 md:p-8">
                    <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-verified-700">
                      <MapPin className="h-4 w-4" /> {property.location}
                    </p>
                    <h2 className="mt-4 text-3xl font-bold text-navy-950">{property.title}</h2>
                    <p className="mt-2 text-2xl font-bold text-navy-950">{currency(property.rent)}/month</p>
                    <p className="mt-5 text-base leading-7 text-slate-600">{property.description}</p>
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Requirement</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{property.requirements.join(" ")}</p>
                    </div>
                    <Button onClick={() => setStep(2)} className="mt-7 w-full sm:w-auto">
                      Start private verification <ShieldCheck className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="source" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
                <section className="card p-6 md:p-8">
                  <h2 className="text-2xl font-bold text-navy-950">Connect tenant wallet and data source</h2>
                  <p className="mt-2 text-slate-600">Your Solana wallet becomes the tenant identity. ProofRent asks Phantom to sign the proof payload before it can be submitted.</p>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Tenant identity</p>
                        <p className="mt-2 break-all text-sm font-bold text-navy-950">
                          {publicKey ? publicKey.toBase58() : "Connect Phantom wallet"}
                        </p>
                      </div>
                      <WalletMultiButton />
                    </div>
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    {[
                      ["Bank API", Banknote],
                      ["Payroll Provider", BriefcaseBusiness],
                      ["Crypto Wallet", WalletCards],
                    ].map(([label, Icon]) => (
                      <DataSourceCard
                        key={label as string}
                        label={label as string}
                        icon={Icon as typeof Banknote}
                        selected={selectedSource === label}
                        onSelect={() => setSelectedSource(label as string)}
                      />
                    ))}
                  </div>
                  {selectedSource && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 rounded-2xl border border-verified-100 bg-verified-50 p-5">
                      <div className="flex items-center gap-3 text-verified-700">
                        <CheckCircle2 className="h-5 w-5" />
                        <p className="font-bold">Payload source connected</p>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-700">Raw data will never be shared with the landlord.</p>
                    </motion.div>
                  )}
                  <Button onClick={() => setStep(3)} className="mt-7" disabled={!selectedSource || !connected || !signMessage}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </section>
                <PrivacyNotice />
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="form" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
                <PrivateDataForm profile={profile} setProfile={setProfile} onVerify={() => setStep(4)} />
                <PrivacyNotice />
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="progress" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="mt-8">
                <VerificationProgress onComplete={finishVerification} />
              </motion.div>
            )}

            {step === 5 && proof && (
              <motion.div key="result" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="mt-8">
                <ProofResultCard proof={proof} property={property} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </Layout>
  );
}

const perExecutionSteps = [
  {
    title: "Tenant wallet signs verification request",
    zone: "Frontend UX",
    detail: "The renter authorizes the request with a Solana wallet identity before any proof is created.",
    icon: WalletCards,
  },
  {
    title: "Financial payload prepared client-side",
    zone: "Frontend UX",
    detail: "Income, expenses, savings, debt, and rent target become either an encrypted MagicBlock payload or explicitly labeled plaintext demo payload.",
    icon: Lock,
  },
  {
    title: "Payload enters simulated execution adapter",
    zone: "Simulated confidential execution",
    detail: "A MagicBlock-compatible boundary receives the protected payload; local demos are plainly marked as plaintext simulation.",
    icon: Layers3,
  },
  {
    title: "Risk checks execute privately",
    zone: "Simulated confidential execution",
    detail: "Affordability, cashflow, reserves, and debt checks run without writing raw fields into public proof state.",
    icon: ServerCog,
  },
  {
    title: "Attestation generated",
    zone: "Simulated confidential execution",
    detail: "Attestation-ready metadata binds the proof hash to local environment details and an expiry window.",
    icon: Stamp,
  },
  {
    title: "Proof signed",
    zone: "Public verification",
    detail: "The sanitized result is signed for reuse and later integrity checks.",
    icon: FileCheck2,
  },
  {
    title: "Landlord receives only verification result",
    zone: "Public verification",
    detail: "The review surface shows status, risk, rent compatibility, validity, and attestation state.",
    icon: ShieldCheck,
  },
  {
    title: "Raw financial data discarded",
    zone: "Simulated confidential execution",
    detail: "Private values are not written into landlord views, proof pages, or reusable public state.",
    icon: EyeOff,
  },
] as const;

function PERExecutionFlow({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const zoneStyles = {
    "Frontend UX": "border-sky-100 bg-sky-50 text-sky-700",
    "Simulated confidential execution": "border-verified-100 bg-verified-50 text-verified-700",
    "Public verification": "border-violet-100 bg-violet-50 text-violet-700",
  } satisfies Record<(typeof perExecutionSteps)[number]["zone"], string>;

  const groupedZones = [
    {
      title: "Frontend UX",
      subtitle: "Consent, encryption, and renter-facing proof request",
      icon: WalletCards,
      steps: perExecutionSteps.filter((step) => step.zone === "Frontend UX"),
    },
    {
      title: "Simulated confidential execution",
      subtitle: "MagicBlock PER-style private state transition",
      icon: Layers3,
      steps: perExecutionSteps.filter((step) => step.zone === "Simulated confidential execution"),
    },
    {
      title: "Public verification",
      subtitle: "Solana-native verification surface for landlords",
      icon: ShieldCheck,
      steps: perExecutionSteps.filter((step) => step.zone === "Public verification"),
    },
  ] as const;

  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card ${className}`}>
      <div className="grid gap-0 lg:grid-cols-[1fr_380px]">
        <div className="p-5 md:p-7">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <Badge tone="navy">MagicBlock-compatible architecture</Badge>
              <h2 className="mt-4 text-3xl font-bold text-navy-950">Privacy-preserving execution on Solana</h2>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
                ProofRent models the MagicBlock PER architecture as three visible boundaries: frontend UX prepares a signed protected request, execution computes attestation-ready proof metadata, and public verification exposes only the result.
              </p>
            </div>
          </div>

          <div className={`mt-6 grid gap-4 ${compact ? "lg:grid-cols-3" : "xl:grid-cols-3"}`}>
            {groupedZones.map((zone, zoneIndex) => {
              const ZoneIcon = zone.icon;
              return (
                <div key={zone.title} className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-navy-950 shadow-card">
                        <ZoneIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-navy-950">{zone.title}</h3>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{zone.subtitle}</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-slate-400">0{zoneIndex + 1}</span>
                  </div>

                  <div className="mt-5 grid gap-3">
                    {zone.steps.map((step, index) => {
                      const StepIcon = step.icon;
                      const globalIndex = perExecutionSteps.findIndex((item) => item.title === step.title);
                      return (
                        <motion.div
                          key={step.title}
                          initial={{ opacity: 0.72, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.45, delay: globalIndex * 0.12, repeat: Infinity, repeatDelay: 7.5, repeatType: "reverse" }}
                          className="rounded-2xl border border-white bg-white p-3 shadow-card"
                        >
                          <div className="flex items-start gap-3">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${zoneStyles[step.zone]}`}>
                              <StepIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-bold leading-5 text-navy-950">
                                {globalIndex + 1}. {step.title}
                              </p>
                              {!compact || index === 0 ? (
                                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{step.detail}</p>
                              ) : null}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-200 bg-navy-950 p-5 text-white lg:border-l lg:border-t-0 md:p-7">
          <AnimatedPERConsole />
        </div>
      </div>
    </section>
  );
}

function AnimatedPERConsole() {
  const proofLines = ["wallet_sig: verified", "payload: protected", "risk_state: local", "attestation_ready: issued", "proof_sig: valid"];
  const checks = ["Integrity", "Proof hash", "Attestation", "Solana verifier"];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-verified-100">Execution graph</p>
          <h3 className="mt-3 text-2xl font-bold">PER state transition</h3>
        </div>
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-verified-500/15 text-verified-100"
        >
          <Layers3 className="h-6 w-6" />
        </motion.div>
      </div>

      <div className="relative mt-7 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-3">
          <GraphNode label="UX" icon={<WalletCards className="h-4 w-4" />} />
          <div className="relative h-2 rounded-full bg-white/10">
            <motion.div
              className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.9)]"
              animate={{ left: ["0%", "48%", "100%"], backgroundColor: ["#7dd3fc", "#5eead4", "#c4b5fd"] }}
              transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <GraphNode label="SOL" icon={<ShieldCheck className="h-4 w-4" />} />
        </div>
        <div className="mx-auto mt-4 w-36 rounded-2xl border border-verified-400/30 bg-verified-400/10 p-3 text-center">
          <ServerCog className="mx-auto h-5 w-5 text-verified-100" />
          <p className="mt-2 text-xs font-bold text-verified-100">PER-ready adapter</p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Simulated private state</p>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {Array.from({ length: 20 }).map((_, index) => (
            <motion.span
              key={index}
              className="h-7 rounded-lg bg-verified-300/20"
              animate={{ opacity: [0.25, 0.9, 0.35], scaleY: [0.75, 1, 0.85] }}
              transition={{ duration: 1.2 + (index % 5) * 0.12, delay: index * 0.04, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {["income", "cashflow", "reserves", "debt"].map((item) => (
            <span key={item} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-300">
              {item}: sealed
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Proof issuance</p>
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="rounded-full bg-verified-400/15 px-3 py-1 text-xs font-bold text-verified-100"
          >
            signing
          </motion.span>
        </div>
        <div className="mt-3 grid gap-2 font-mono text-xs text-slate-300">
          {proofLines.map((line, index) => (
            <motion.p
              key={line}
              initial={{ opacity: 0.4, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: index * 0.22, repeat: Infinity, repeatDelay: 5, repeatType: "reverse" }}
            >
              {line}
            </motion.p>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Attestation verification</p>
        <div className="mt-3 grid gap-2">
          {checks.map((check, index) => (
            <motion.div
              key={check}
              className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2"
              animate={{ borderColor: ["rgba(255,255,255,0.08)", "rgba(110,231,183,0.45)", "rgba(255,255,255,0.08)"] }}
              transition={{ duration: 1.8, delay: index * 0.2, repeat: Infinity }}
            >
              <span className="text-sm font-semibold text-slate-300">{check}</span>
              <CheckCircle2 className="h-4 w-4 text-verified-100" />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GraphNode({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="flex h-11 w-11 flex-col items-center justify-center rounded-2xl bg-white text-navy-950">
      {icon}
      <span className="mt-0.5 text-[10px] font-bold">{label}</span>
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = ["Property", "Source", "Private data", "Passport"];

  return (
    <div className="mt-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-card md:grid-cols-4">
      {steps.map((label, index) => {
        const stepNumber = index + 1;
        const done = currentStep > stepNumber;
        const active = currentStep === stepNumber;
        return (
          <div key={label} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${active ? "bg-navy-950 text-white" : "bg-slate-50 text-slate-600"}`}>
            <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-verified-100 text-verified-700" : active ? "bg-white text-navy-950" : "bg-white text-slate-400"}`}>
              {done ? <Check className="h-4 w-4" /> : stepNumber}
            </span>
            <span className="text-sm font-bold">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function DataSourceCard({
  label,
  icon: Icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: typeof Banknote;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-card ${
        selected ? "border-verified-300 bg-verified-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${selected ? "bg-verified-100 text-verified-700" : "bg-slate-100 text-navy-950"}`}>
          <Icon className="h-6 w-6" />
        </span>
        {selected ? <CheckCircle2 className="h-5 w-5 text-verified-700" /> : <Circle className="h-5 w-5 text-slate-300" />}
      </div>
      <h3 className="mt-5 text-base font-bold text-navy-950">{label}</h3>
    </button>
  );
}

function PrivateDataForm({
  profile,
  setProfile,
  onVerify,
}: {
  profile: PrivateFinancialProfile;
  setProfile: React.Dispatch<React.SetStateAction<PrivateFinancialProfile>>;
  onVerify: () => void;
}) {
  const fields: Array<[keyof PrivateFinancialProfile, string]> = [
    ["monthlyIncome", "monthlyIncome"],
    ["monthlyExpenses", "monthlyExpenses"],
    ["savings", "savings"],
    ["monthlyDebt", "monthlyDebt"],
  ];

  const setDemo = (nextProfile: PrivateFinancialProfile) => setProfile(nextProfile);
  const hasValues = fields.every(([key]) => profile[key] >= 0) && profile.monthlyIncome > 0;

  return (
    <section className="card p-6 md:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-950 text-white">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-navy-950">Private demo form</h2>
          <p className="text-sm font-semibold text-slate-500">Demo private inputs</p>
        </div>
      </div>
      <p className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">
        {PLAINTEXT_DEMO_MESSAGE}
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {fields.map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-sm font-bold text-slate-700">{label}</span>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus-within:ring-4 focus-within:ring-emerald-100">
              <BadgeDollarSign className="h-5 w-5 text-slate-400" />
              <input
                type="number"
                min="0"
                value={profile[key]}
                onChange={(event) => setProfile((current) => ({ ...current, [key]: Number(event.target.value) }))}
                className="w-full bg-transparent text-base font-semibold text-navy-950 outline-none"
              />
            </div>
          </label>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() =>
            setDemo({
              monthlyIncome: 4200,
              monthlyExpenses: 1500,
              savings: 6000,
              monthlyDebt: 400,
            })
          }
        >
          Use strong demo profile
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            setDemo({
              monthlyIncome: 1700,
              monthlyExpenses: 1300,
              savings: 300,
              monthlyDebt: 900,
            })
          }
        >
          Use risky demo profile
        </Button>
      </div>
      <Button onClick={onVerify} disabled={!hasValues} className="mt-7 w-full sm:w-auto">
        Verify with local proof flow <ShieldCheck className="h-4 w-4" />
      </Button>
    </section>
  );
}

function VerificationProgress({ onComplete, framed = true }: { onComplete: () => void; framed?: boolean }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMessageIndex((current) => Math.min(current + 1, verificationProgressMessages.length - 1));
    }, 650);
    const timeout = window.setTimeout(onComplete, 4200);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [onComplete]);

  return (
    <section className={`${framed ? "card overflow-hidden" : ""} p-8 text-center`}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-slate-100 border-t-verified-600"
      >
        <Lock className="h-8 w-8 text-navy-950" />
      </motion.div>
      <h2 className="mt-7 text-3xl font-bold text-navy-950">Simulated confidential execution running</h2>
      <div className="mx-auto mt-6 max-w-xl rounded-2xl bg-navy-950 p-5 text-left text-white">
        <AnimatePresence mode="wait">
          <motion.p key={verificationProgressMessages[messageIndex]} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="font-semibold">
            {verificationProgressMessages[messageIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="mx-auto mt-6 h-2 max-w-xl overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="h-full rounded-full bg-verified-600"
          initial={{ width: "5%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 4.2, ease: "easeInOut" }}
        />
      </div>
    </section>
  );
}

function ProofResultCard({
  proof,
  property,
}: {
  proof: Proof;
  property: Property;
}) {
  const navigate = useNavigate();
  const approved = proof.status === "Tenant Verified";
  const verification = verifyProofAuthenticity(proof);

  const submitApplication = () => {
    if (!verification.valid) return;
    const nextApplication = queueLandlordApplication(property.id, proof.id);
    navigate(`/landlord/application/${nextApplication.id}`);
  };

  const copyProofLink = () => {
    navigator.clipboard?.writeText(publicProofUrl(proof));
  };

  if (!approved) {
    return (
      <section className="card p-6 md:p-8">
        <ProofStatusHeader proof={proof} title="Passport not issued" subtitle="Failed proof state" />
        <div
          className={`mt-7 rounded-2xl border p-4 text-sm font-bold ${
            hasVerifiedMagicBlockPER(proof)
              ? "border-verified-100 bg-verified-50 text-verified-700"
              : "border-amber-100 bg-amber-50 text-amber-800"
          }`}
        >
          {hasVerifiedMagicBlockPER(proof)
            ? "Executed via MagicBlock PER"
            : "Simulated local confidential execution"}
        </div>
        <ProofDetailsGrid
          details={[
            { label: "Risk Level", value: "High" },
            { label: "Proof state", value: "Failed" },
            { label: "Proof ID", value: proof.id },
            { label: "Provider", value: proof.executionMetadata?.provider ?? "local-simulation" },
          ]}
        />
        <ProofChecksList
          checks={{
            incomeCheck: "failed",
            cashflowCheck: "failed",
            savingsCheck: "failed",
            debtCheck: "failed",
          }}
          labels={rejectedCheckLabels}
        />
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => navigate(`/verify/${property.id}`)}>Try another profile</Button>
          <Button variant="secondary" onClick={() => navigate("/properties")}>Back to properties</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="card p-6 md:p-8">
      <ProofStatusHeader proof={proof} title="Privacy-preserving Rental Passport issued" subtitle="Reusable approved credential" />
      <div
        className={`mt-7 rounded-2xl border p-4 text-sm font-bold ${
          hasVerifiedMagicBlockPER(proof)
            ? "border-verified-100 bg-verified-50 text-verified-700"
            : "border-amber-100 bg-amber-50 text-amber-800"
        }`}
      >
        {hasVerifiedMagicBlockPER(proof)
          ? "Executed via MagicBlock PER"
          : "Simulated local confidential execution"}
      </div>
      <ProofDetailsGrid
        details={[
          { label: "Compatible rent", value: rentRangeLabel(proof) },
          { label: "Risk category", value: <RiskBadge risk={proof.riskCategory} /> },
          { label: "Validity", value: validityLabel(proof) },
          { label: "Attestation", value: proof.attestationStatus === "attested" ? "Attested" : "Failed" },
          { label: "Proof ID", value: proof.id },
          { label: "Tenant Wallet", value: proof.tenantWallet },
          { label: "Local proof check", value: verification.valid ? "Passed locally" : "Invalid" },
          { label: "Valid for", value: "30 days" },
          { label: "Compatible with", value: property.title },
          { label: "Listing rent", value: `${currency(property.rent)}/month` },
          { label: "Execution", value: proof.executionProvider ?? "MVP provider adapter" },
          { label: "Provider", value: proof.executionMetadata?.provider ?? "local-simulation" },
          { label: "Access token", value: proof.executionMetadata?.accessTokenUsed ? "Used" : "Not used" },
          { label: "Proof hash", value: proof.proofHash ?? "Unavailable" },
          {
            label: "On-chain status",
            value: proof.onChainCommitment?.configured
              ? proof.commitmentStatus ?? proof.onChainCommitment.status
              : "Solana settlement not configured",
          },
          { label: "Solana tx", value: <SolanaTransactionLink proof={proof} /> },
          { label: "Committed at", value: proof.committedAt ? dateTimeShort(proof.committedAt) : "Unavailable" },
          { label: "Attestation", value: proof.attestation?.measurement ?? "Pending adapter quote" },
          { label: "Verifier", value: proof.verifierProgram ?? "ProofRent verifier adapter" },
        ]}
      />
      <ProofChecksList checks={proof.checks} labels={approvedCheckLabels} />
      <ProofPrivacyText />
      {!verification.valid ? (
        <p className="mt-7 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          This proof cannot be submitted: {verification.reason}
        </p>
      ) : null}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <Button onClick={submitApplication} disabled={!verification.valid}>Open landlord review</Button>
        <Button variant="secondary" onClick={copyProofLink}>
          Copy proof link <Copy className="h-4 w-4" />
        </Button>
        <Button variant="secondary" onClick={() => navigate("/tenant/passport")}>
          Passport dashboard <ExternalLink className="h-4 w-4" />
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/verify-proof/${proof.id}?proof=${encodeProofPayload(proof)}`)}>
          View as landlord <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function PrivacyNotice() {
  return (
    <aside className="card bg-navy-950 p-6 text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-verified-500/15 text-verified-100">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-lg font-bold">Privacy notice</h3>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Raw provider data and private demo values stay inside the verification flow. The landlord receives only rent compatibility, risk category, validity, proof ID, and attestation status.
      </p>
    </aside>
  );
}

function TenantPassportDashboardPage() {
  const { properties, proofs, refresh } = useSeededData();
  const navigate = useNavigate();

  const revokePassport = async (proof: Proof) => {
    revokeStoredProof(proof.id, "Revoked by tenant from passport dashboard.");
    await revokeProofEndpoint(proof.id, "Revoked by tenant from passport dashboard.").catch(() => undefined);
    refresh();
  };

  const reuseForProperty = (proof: Proof, property: Property) => {
    const nextApplication = queueLandlordApplication(property.id, proof.id);
    navigate(`/landlord/application/${nextApplication.id}`);
  };

  return (
    <Layout>
      <main className="container-page py-12">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Badge tone="green">Privacy-preserving Rental Passport</Badge>
            <h1 className="mt-4 text-4xl font-bold text-navy-950">Reusable proof dashboard</h1>
            <p className="mt-3 max-w-2xl text-slate-600">
              Manage reusable tenant credentials, share public verification URLs, reuse active proofs for compatible listings, and revoke access when needed.
            </p>
          </div>
          <Link to="/properties">
            <Button>
              Browse compatible properties <Home className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        {proofs.length === 0 ? (
          <section className="card mt-8 p-10 text-center">
            <Stamp className="mx-auto h-10 w-10 text-verified-600" />
            <h2 className="mt-4 text-2xl font-bold text-navy-950">No passports yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              Create a privacy-preserving Rental Passport from any property page. The issued credential can be reused wherever the rent fits its compatibility range.
            </p>
            <Link to="/properties" className="mt-6 inline-flex">
              <Button>Create passport</Button>
            </Link>
          </section>
        ) : (
          <div className="mt-8 grid gap-6">
            {proofs.map((proof) => {
              const verification = verifyProofAuthenticity(proof);
              const compatibleProperties = properties.filter((property) => isProofCompatibleWithRent(proof, property.rent));
              const expired = Date.parse(proof.expiresAt) <= Date.now();
              const revoked = proof.validity === "revoked" || Boolean(proof.revokedAt);

              return (
                <article key={proof.id} className="card p-6 md:p-7">
                  <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge tone={verification.valid ? "amber" : "rose"}>
                          {verification.valid ? "Local passport check" : validityLabel(proof)}
                        </Badge>
                        {isSimulationOnlyProof(proof) ? <Badge tone="amber">Simulation only</Badge> : <Badge tone="slate">Backend-issued proof</Badge>}
                        <RiskBadge risk={proof.riskCategory} />
                      </div>
                      <h2 className="mt-4 text-2xl font-bold text-navy-950">Privacy-preserving Rental Passport</h2>
                      <p className="mt-2 break-all text-sm font-semibold text-slate-500">{proof.id}</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(publicProofUrl(proof))}>
                        Copy share URL <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="secondary" onClick={() => navigate(`/verify-proof/${proof.id}?proof=${encodeProofPayload(proof)}`)}>
                        Verify <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button variant="danger" onClick={() => revokePassport(proof)} disabled={revoked}>
                        Revoke
                      </Button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <ApplicationDetail label="Compatible rent range" value={rentRangeLabel(proof)} />
                    <ApplicationDetail label="Risk category" value={<RiskBadge risk={proof.riskCategory} />} />
                    <ApplicationDetail label="Validity" value={validityLabel(proof)} />
                    <ApplicationDetail label="Attestation status" value={proof.attestationStatus === "attested" ? "Attested" : "Failed"} />
                    <ApplicationDetail label="Expires" value={dateShort(proof.expiresAt)} />
                  </div>

                  <VerificationBadges proof={proof} verification={verification} />
                  <AttestationMetadataPanel proof={proof} verification={verification} />
                  <VerificationPipeline verification={verification} />

                  {expired || revoked ? (
                    <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-4">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <p className="text-sm font-bold text-amber-800">
                          {revoked ? proof.revocationReason ?? "This passport has been revoked." : "This passport has expired. Issue a fresh credential before reuse."}
                        </p>
                        <Button variant="secondary" onClick={() => navigate(`/verify/${proof.propertyIds[0] ?? demoPropertyId}`)}>
                          Renew <RefreshCcw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-7">
                    <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Compatible properties</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {compatibleProperties.length > 0 ? (
                        compatibleProperties.map((property) => (
                          <div key={property.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                              <div>
                                <p className="font-bold text-navy-950">{property.title}</p>
                                <p className="mt-1 text-sm font-semibold text-slate-500">{currency(property.rent)}/month - {property.location}</p>
                              </div>
                              <Button onClick={() => reuseForProperty(proof, property)} className="w-full sm:w-auto">
                                Reuse <Link2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                          No current listings fit this passport's rent range.
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </Layout>
  );
}

function VerificationBadges({
  proof,
  verification,
}: {
  proof: Proof;
  verification: ReturnType<typeof verifyProofAuthenticity>;
}) {
  const badges = [
    { label: "Signed", active: verification.signatureValid },
    { label: "Check passed", active: verification.valid },
    { label: "Untampered", active: verification.integrityValid && verification.proofHashValid },
    { label: "Active", active: !verification.expired && !verification.revoked },
    { label: "Attested", active: proof.attestationStatus === "attested" && verification.attestationSignatureValid },
  ];

  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ring-1 ${
            badge.active ? "bg-verified-50 text-verified-700 ring-verified-100" : "bg-rose-50 text-rose-700 ring-rose-100"
          }`}
        >
          {badge.active ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function AttestationStateBadge({ verification }: { verification: ReturnType<typeof verifyProofAuthenticity> }) {
  if (verification.verificationStatus === "verified" && verification.trustedIssuerValid) return <Badge tone="green">Trusted issuer verified</Badge>;
  if (!verification.trustedIssuerValid) return <Badge tone="rose">Unknown issuer</Badge>;
  if (verification.verificationStatus === "invalid_signature") return <Badge tone="rose">Invalid signature</Badge>;
  if (verification.verificationStatus === "expired") return <Badge tone="amber">Expired Proof</Badge>;
  if (verification.verificationStatus === "tampered") return <Badge tone="rose">Tampered proof</Badge>;
  return <Badge tone="rose">Invalid Proof</Badge>;
}

function AttestationMetadataPanel({
  proof,
  verification,
}: {
  proof: Proof;
  verification: ReturnType<typeof verifyProofAuthenticity>;
}) {
  const verifiedMagicBlock = hasVerifiedMagicBlockPER(proof);

  return (
    <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="navy">Attestation metadata</Badge>
            <AttestationStateBadge verification={verification} />
          </div>
          <h3 className="mt-4 text-xl font-bold text-navy-950">
            {verifiedMagicBlock ? "Executed via MagicBlock PER" : "Generated via simulated confidential execution adapter"}
          </h3>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
            {verifiedMagicBlock
              ? "The backend signed this proof from a verified MagicBlock PER execution receipt and attestation evidence."
              : "This local adapter models the attestation-ready structure a MagicBlock PER integration could replace. It does not claim production private-runtime execution in this MVP."}
          </p>
        </div>
        <ShieldCheck className="h-8 w-8 text-verified-700" />
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ApplicationDetail label="Attestation ID" value={proof.attestation?.attestationId ?? "Unavailable"} />
        <ApplicationDetail label="Proof hash" value={proof.attestation?.proofHash ?? "Unavailable"} />
        <ApplicationDetail label="Issuer" value={proof.attestation?.issuer ?? "Unavailable"} />
        <ApplicationDetail label="Execution environment" value={proof.attestation?.executionEnvironment ?? "Unavailable"} />
        <ApplicationDetail label="Runtime ID" value={proof.executionMetadata?.runtimeId ?? "Unavailable"} />
        <ApplicationDetail label="Measurement hash" value={proof.executionMetadata?.measurementHash ?? "Unavailable"} />
        <ApplicationDetail label="Attestation expires" value={proof.attestation ? dateShort(proof.attestation.expiresAt) : "Unavailable"} />
        <ApplicationDetail label="Verification status" value={<AttestationStateBadge verification={verification} />} />
      </div>
    </section>
  );
}

function VerificationPipeline({ verification }: { verification: ReturnType<typeof verifyProofAuthenticity> }) {
  const steps = [
    ["Integrity", verification.integrityValid],
    ["Expiration", !verification.expired && !verification.attestationExpired],
    ["Proof hash", verification.proofHashValid],
    ["Proof signature", verification.signatureValid],
    ["Attestation signature", verification.attestationSignatureValid],
  ] as const;

  return (
    <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Verification pipeline</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map(([label, passed]) => (
          <div key={label} className={`rounded-2xl border p-4 ${passed ? "border-verified-100 bg-verified-50" : "border-rose-100 bg-rose-50"}`}>
            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${passed ? "bg-verified-100 text-verified-700" : "bg-rose-100 text-rose-700"}`}>
              {passed ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            </div>
            <p className="mt-3 text-sm font-bold text-navy-950">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrustBoundaryVisualization() {
  return (
    <section className="mt-7 rounded-2xl border border-slate-200 bg-navy-950 p-5 text-white">
      <p className="text-sm font-bold uppercase tracking-[0.18em] text-verified-100">Trust boundary</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {[
          ["Tenant", "Private signals enter protected request", Lock],
          ["Execution adapter", "Simulates private evaluation and discards raw values", DatabaseZap],
          ["Attestation", "Binds proof hash to signed environment metadata", Stamp],
          ["Landlord", "Sees only passport status and compatibility", ShieldCheck],
        ].map(([title, text, Icon]) => {
          const BoundaryIcon = Icon as typeof Lock;
          return (
            <div key={title as string} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <BoundaryIcon className="h-5 w-5 text-verified-100" />
              <h4 className="mt-3 font-bold">{title as string}</h4>
              <p className="mt-2 text-sm leading-6 text-slate-300">{text as string}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TenantProofPage() {
  const { proofId } = useParams();
  const proof = findProof(proofId);
  const property = findProperty(proof?.propertyIds?.[0] ?? proof?.propertyId);
  if (!proof) return <Navigate to="/properties" replace />;

  return (
    <Layout>
      <main className="container-page grid gap-8 py-12 lg:grid-cols-[1fr_360px]">
        <ProofSummary proof={proof} property={property} />
        <aside className="space-y-5">
          <div className="card p-6">
            <h3 className="text-lg font-bold">Share proof</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Public verification pages expose only sanitized proof fields.</p>
            <Link to={`/verify-proof/${proof.id}?proof=${encodeProofPayload(proof)}`} className="mt-5 block">
              <Button className="w-full">
                Public proof page <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/tenant/passport" className="mt-3 block">
              <Button variant="secondary" className="w-full">
                Dashboard <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <PrivacyPanel />
        </aside>
      </main>
    </Layout>
  );
}

function TenantResultPage() {
  const { proofId } = useParams();
  const proof = findProof(proofId);
  const property = findProperty(proof?.propertyId);

  if (!proof || !property) return <Navigate to="/properties" replace />;

  return (
    <Layout>
      <main className="container-page py-12">
        <div className="mx-auto max-w-5xl">
          <ProofResultCard proof={proof} property={property} />
        </div>
      </main>
    </Layout>
  );
}

function acceptApplication(applicationId: string, backendVerified = false) {
  const currentApplication = findApplication(applicationId);
  if (!backendVerified) {
    return currentApplication;
  }

  const next = getApplications().map((application) =>
    application.id === applicationId
      ? {
          ...application,
          status: "accepted" as const,
          contactUnlocked: true,
        }
      : application,
  );
  saveApplications(next);
  return next.find((application) => application.id === applicationId);
}

function rejectApplication(applicationId: string) {
  const next = getApplications().map((application) =>
    application.id === applicationId
      ? {
          ...application,
          status: "rejected" as const,
        }
      : application,
  );
  saveApplications(next);
  return next.find((application) => application.id === applicationId);
}

function ApplicationDetail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className="mt-2 break-words text-sm font-bold text-navy-950">{value}</div>
    </div>
  );
}

function ApplicationStatusBadge({ status }: { status: Application["status"] }) {
  const tone = status === "accepted" ? "green" : status === "rejected" ? "rose" : "amber";
  return <Badge tone={tone}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

const handoffMethodOptions = [
  "In-person meeting",
  "Smart lock access code",
  "Pickup point",
];

function updateApplicationHandoffMethod(applicationId: string, handoffMethod: string) {
  const next = getApplications().map((application) =>
    application.id === applicationId
      ? {
          ...application,
          handoffMethod,
        }
      : application,
  );
  saveApplications(next);
  return next.find((application) => application.id === applicationId);
}

function MutualRevealPanel({
  application,
  onUpdate,
}: {
  application: Application;
  onUpdate: (application?: Application) => void;
}) {
  const [selectedMethod, setSelectedMethod] = useState(
    application.handoffMethod ?? "In-person meeting",
  );
  const accepted = application.status === "accepted" && application.contactUnlocked;

  useEffect(() => {
    setSelectedMethod(application.handoffMethod ?? "In-person meeting");
  }, [application.handoffMethod]);

  const confirmHandoffMethod = () => {
    onUpdate(updateApplicationHandoffMethod(application.id, selectedMethod));
  };

  if (!accepted) {
    return (
      <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-card">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-navy-950">Mutual Reveal</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
              Contact details are locked until landlord approval.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-7 rounded-2xl border border-verified-100 bg-verified-50 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-verified-100 text-verified-700">
          <KeyRound className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-navy-950">Contact unlocked</h2>
            {application.handoffMethod ? <Badge tone="green">Handoff scheduled</Badge> : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ApplicationDetail label="Tenant contact" value="@tenant_demo" />
            <ApplicationDetail label="Preferred handoff" value="In-person meeting" />
          </div>
          <div className="mt-4 rounded-2xl border border-verified-100 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Message</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-navy-950">
              "I'm available tomorrow after 18:00."
            </p>
          </div>
          <p className="mt-4 text-sm font-bold text-navy-950">
            Next step: schedule key handoff.
          </p>

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Handoff method
            </p>
            <div className="mt-3 grid gap-3">
              {handoffMethodOptions.map((method) => (
                <label
                  key={method}
                  className={`focus-within:ring-2 focus-within:ring-verified-500 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-white px-4 py-3 text-sm font-semibold transition ${
                    selectedMethod === method
                      ? "border-verified-300 text-navy-950 shadow-card"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span>{method}</span>
                  <input
                    type="radio"
                    name={`handoff-method-${application.id}`}
                    value={method}
                    checked={selectedMethod === method}
                    onChange={() => setSelectedMethod(method)}
                    className="h-4 w-4 accent-verified-600"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={confirmHandoffMethod}>Confirm handoff method</Button>
            {application.handoffMethod ? (
              <p className="text-sm font-semibold text-verified-700">
                This step happens only after landlord approval and mutual contact reveal.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function LandlordPage() {
  const { properties, applications, proofs, refresh } = useSeededData();
  const rows = applications.map((application) => ({
    application,
    proof: proofs.find((proof) => proof.id === application.proofId),
    property: properties.find((property) => property.id === application.propertyId),
  }));

  const onAccept = async (applicationId: string) => {
    const application = applications.find((item) => item.id === applicationId);
    const proof = proofs.find((item) => item.id === application?.proofId || item.proofId === application?.proofId);
    if (!application) {
      return {
        ok: false,
        message: "Application not found.",
      };
    }
    if (!proof) {
      return {
        ok: false,
        message: "Proof not found.",
      };
    }
    const result = await verifyAndAcceptApplication(application, proof);
    if (result.ok) refresh();
    return result;
  };

  const onReject = (applicationId: string) => {
    rejectApplication(applicationId);
    refresh();
  };

  return (
    <Layout>
      <main className="container-page py-12">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Badge tone="navy">Landlord console</Badge>
            <h1 className="mt-4 text-4xl font-bold text-navy-950">Applications without financial exposure</h1>
            <p className="mt-3 max-w-2xl text-slate-600">Review applicant eligibility using compatible rent range, risk category, validity, proof ID, and attestation status only.</p>
          </div>
          <PrivacySeal />
        </div>
        <div className="mt-8">
          <LandlordDashboard rows={rows} onAccept={onAccept} onReject={onReject} />
        </div>
      </main>
    </Layout>
  );
}

function LandlordApplicationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [application, setApplication] = useState(() => findApplication(id));
  const proof = findProof(application?.proofId);
  const property = findProperty(application?.propertyId);
  const demoAccept = searchParams.get("demo") === "accept";
  const [backendVerification, setBackendVerification] = useState<BackendProofVerificationResult | null>(null);
  const [backendVerificationError, setBackendVerificationError] = useState<string | null>(null);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [acceptSuccess, setAcceptSuccess] = useState<string | null>(null);
  const proofVerification = backendVerification;

  const proofCanBeAccepted = canAcceptForLandlord(proof, proofVerification);
  const approved = Boolean(proof && proofCanBeAccepted);
  const onAccept = async () => {
    if (!application || !proof) return;
    setAcceptLoading(true);
    setAcceptSuccess(null);
    setBackendVerificationError(null);
    const result = await verifyAndAcceptApplication(application, proof);
    if (result.verification) {
      setBackendVerification(result.verification);
    }
    if (result.ok) {
      setApplication(result.application);
      setAcceptSuccess(result.message);
      setBackendVerificationError(null);
    } else {
      setBackendVerificationError(result.message);
      if (!result.verification) setBackendVerification(null);
    }
    setAcceptLoading(false);
  };

  const onReject = () => {
    if (!application) return;
    setApplication(rejectApplication(application.id));
    setAcceptSuccess(null);
  };

  useEffect(() => {
    if (!proof) return;
    verifyProofBackend(proof)
      .then(({ verification }) => {
        setBackendVerification(verification);
        setBackendVerificationError(isBackendAcceptedForLandlord(verification) ? null : verification.reason);
      })
      .catch((error) => {
        setBackendVerification(null);
        setBackendVerificationError(backendVerificationErrorMessage(error));
      });
  }, [proof?.id]);

  useEffect(() => {
    if (!application || !demoAccept || application.status !== "pending" || !approved) return;
    const timeout = window.setTimeout(() => {
      setApplication(acceptApplication(application.id, true));
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [application, approved, demoAccept]);

  if (!application || !proof) return <Navigate to="/landlord" replace />;

  return (
    <Layout>
      <main className="container-page grid gap-8 py-12 lg:grid-cols-[1fr_360px]">
        <section className="card p-6 md:p-8">
          {demoAccept ? (
            <div className="mb-7 rounded-2xl border border-verified-100 bg-verified-50 p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <Badge tone={application.contactUnlocked ? "green" : "amber"}>
                    {application.contactUnlocked ? "Demo complete" : "Demo landlord review"}
                  </Badge>
                  <h2 className="mt-3 text-2xl font-bold text-navy-950">
                    {application.contactUnlocked ? "Landlord accepted. Contact is unlocked." : "Landlord sees proof only and is accepting now."}
                  </h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                    The private profile values are absent here. The landlord can review rent compatibility, risk category, proof ID, validity, and attestation status.
                  </p>
                </div>
                {application.contactUnlocked ? <KeyRound className="h-9 w-9 text-verified-700" /> : <ShieldCheck className="h-9 w-9 text-verified-700" />}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
            <div>
              <Badge tone="navy">Application review</Badge>
              <h1 className="mt-4 text-4xl font-bold text-navy-950">{property?.title ?? "Rental application"}</h1>
              <p className="mt-3 max-w-2xl text-slate-600">Review the tenant proof without accessing private financial records.</p>
            </div>
            <ApplicationStatusBadge status={application.status} />
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ApplicationDetail label="Tenant" value={approved ? "Tenant Verified" : "Not Verified"} />
            <ApplicationDetail label="Compatible rent" value={rentRangeLabel(proof)} />
            <ApplicationDetail label="Risk category" value={<RiskBadge risk={proof.riskCategory} />} />
            <ApplicationDetail label="Validity" value={validityLabel(proof)} />
            <ApplicationDetail label="Backend verification" value={<BackendVerificationBadge verification={proofVerification} unavailable={!proofVerification && !backendVerificationError} />} />
            <ApplicationDetail label="Diagnostics" value={verificationDiagnosticsText(proofVerification)} />
            <ApplicationDetail label="Execution mode" value={isSimulationOnlyProof(proof) ? <Badge tone="amber">Simulation only</Badge> : <Badge tone="green">Backend issued</Badge>} />
            <ApplicationDetail label="Attestation" value={proofVerification ? <AttestationStateBadge verification={proofVerification} /> : "Verification unavailable"} />
            <ApplicationDetail label="Proof ID" value={proof.id} />
            <ApplicationDetail label="Tenant Wallet" value={proof.tenantWallet} />
            <ApplicationDetail label="Signature" value={proofVerification?.signatureValid ? "Verified" : "Invalid"} />
            <ApplicationDetail
              label="On-chain status"
              value={
                proof.onChainCommitment?.configured
                  ? proof.commitmentStatus ?? proof.onChainCommitment.status
                  : "Solana settlement not configured"
              }
            />
            <ApplicationDetail label="Solana transaction" value={<SolanaTransactionLink proof={proof} />} />
            <ApplicationDetail label="Committed at" value={proof.committedAt ? dateTimeShort(proof.committedAt) : "Unavailable"} />
            <ApplicationDetail label="Valid until" value={dateShort(proof.expiresAt)} />
            <ApplicationDetail label="Submitted time" value={dateTimeShort(application.submittedAt)} />
            <ApplicationDetail label="Contact" value={application.contactUnlocked ? "Unlocked" : "Locked"} />
          </div>
          {proofVerification ? <VerificationBadges proof={proof} verification={proofVerification} /> : null}
          {proofVerification ? (
            <>
              <AttestationMetadataPanel proof={proof} verification={proofVerification} />
              <VerificationPipeline verification={proofVerification} />
            </>
          ) : null}

          {proofVerification && !proofVerification.valid ? (
            <p className="mt-7 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
              Landlord verification failed: {proofVerification.reason}
            </p>
          ) : null}
          {backendVerificationError ? (
            <p className="mt-7 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
              Backend verification: {backendVerificationError}
            </p>
          ) : null}
          {acceptSuccess ? (
            <p className="mt-7 rounded-2xl border border-verified-100 bg-verified-50 p-4 text-sm font-bold text-verified-700">
              {acceptSuccess}
            </p>
          ) : null}
          {acceptLoading ? (
            <p className="mt-7 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800">
              Verifying proof...
            </p>
          ) : null}

          <p className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">
            Raw income, expenses, savings, debt, and bank statements are never shown to the landlord. Only the reusable passport fields are shared.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button onClick={onAccept} disabled={application.status === "accepted" || acceptLoading}>
              {acceptLoading ? "Verifying proof..." : "Accept applicant"} <CheckCircle2 className="h-4 w-4" />
            </Button>
            <Button variant="danger" onClick={onReject} disabled={application.status === "rejected"}>
              Reject application
            </Button>
            <Button variant="secondary" onClick={() => navigate("/landlord")}>
              Back to dashboard
            </Button>
          </div>

          <MutualRevealPanel application={application} onUpdate={setApplication} />
        </section>
        <aside className="space-y-5">
          <div className="card p-6">
            <p className="text-sm font-semibold text-slate-500">Application status</p>
            <h2 className="mt-2 text-2xl font-bold capitalize">{application.status}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Contact details stay locked until the proof outcome is accepted. No raw financial documents are available.
            </p>
            <div className="mt-6 grid gap-3">
              <Button onClick={onAccept} disabled={application.status === "accepted" || acceptLoading}>
                {acceptLoading ? "Verifying proof..." : "Accept applicant"} <CheckCircle2 className="h-4 w-4" />
              </Button>
              <Button variant="danger" onClick={onReject} disabled={application.status === "rejected"}>Reject application</Button>
              <Button variant="secondary" onClick={() => navigate(`/verify-proof/${proof.id}?proof=${encodeProofPayload(proof)}`)}>
                Verify proof page <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="card p-6">
            <h3 className="font-bold">Handoff</h3>
            <p className="mt-2 text-sm text-slate-600">
              {application.handoffMethod
                ? `Handoff scheduled via ${application.handoffMethod}.`
                : application.contactUnlocked
                  ? "Contact unlocked. Choose a handoff method to schedule the next step."
                  : "Locked until the landlord accepts this proof."}
            </p>
          </div>
        </aside>
      </main>
    </Layout>
  );
}

function PublicProofPage() {
  const { proofId } = useParams();
  const [searchParams] = useSearchParams();
  const { properties } = useSeededData();
  const [publicProof, setPublicProof] = useState<Proof | undefined>();
  const [loading, setLoading] = useState(true);
  const [backendVerification, setBackendVerification] = useState<BackendProofVerificationResult | null>(null);
  const [backendVerificationError, setBackendVerificationError] = useState<string | null>(null);

  useEffect(() => {
    if (!proofId) return;
    const embeddedProof = decodeProofPayload(searchParams.get("proof"));
    setLoading(true);
    getPublicProof(proofId)
      .then(({ proof, verification }) => {
        setPublicProof(proof);
        setBackendVerification(verification);
        setBackendVerificationError(verification.valid ? null : verification.reason);
      })
      .catch((error) => {
        const storedProof = findProof(proofId);
        const fallbackProof =
          embeddedProof && (embeddedProof.proofId === proofId || embeddedProof.id === proofId)
            ? embeddedProof
            : storedProof;
        if (!fallbackProof) {
          setPublicProof(undefined);
          setBackendVerification(null);
          setBackendVerificationError(error instanceof Error ? error.message : "Backend verification failed.");
          return;
        }

        setPublicProof(fallbackProof);
        return verifyProofBackend(fallbackProof)
          .then(({ verification }) => {
            setBackendVerification(verification);
            setBackendVerificationError(isBackendAcceptedForLandlord(verification) ? null : verification.reason);
          })
          .catch((verifyError) => {
            setBackendVerification(null);
            setBackendVerificationError(backendVerificationErrorMessage(verifyError));
          });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [proofId, searchParams]);

  const proof = publicProof;

  if (loading) {
    return (
      <Layout>
        <main className="container-page py-12">
          <section className="card p-8 text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-100 border-t-verified-600" />
            <p className="mt-5 text-sm font-bold text-slate-600">Loading proof verification...</p>
          </section>
        </main>
      </Layout>
    );
  }
  if (!proof) {
    return (
      <Layout>
        <main className="container-page py-12">
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-6 text-sm font-bold text-rose-700">
            Backend verification failed: {backendVerificationError}
          </div>
        </main>
      </Layout>
    );
  }

  const localVerification = verifyProofAuthenticity(proof);
  const verification = backendVerification ?? localVerification;
  const approved = proof.status === "Tenant Verified" && canAcceptForLandlord(proof, backendVerification);

  return (
    <Layout>
      <main className="container-page py-12">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <BackendVerificationBadge verification={backendVerification} unavailable={!backendVerification && !backendVerificationError} />
              <h1 className="mt-4 text-4xl font-bold text-navy-950">Privacy-preserving Rental Passport check</h1>
            </div>
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
              Copy link <Copy className="h-4 w-4" />
            </Button>
          </div>
          <section className="card p-6 md:p-8">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
              <div>
                <ProofBadge proof={proof} label={proof.status} />
                <h2 className="mt-4 text-4xl font-bold text-navy-950">
                  {approved ? "Passport Verified" : "Not Verified"}
                </h2>
              </div>
              <RiskBadge risk={proof.riskCategory} />
            </div>

            {verification ? <VerificationBadges proof={proof} verification={verification} /> : null}
            {verification ? <AttestationMetadataPanel proof={proof} verification={verification} /> : null}
            {verification ? <VerificationPipeline verification={verification} /> : null}

            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ApplicationDetail label="Tenant" value={approved ? "Tenant Verified" : "Not Verified"} />
              <ApplicationDetail label="Compatible rent range" value={rentRangeLabel(proof)} />
              <ApplicationDetail label="Risk category" value={<RiskBadge risk={proof.riskCategory} />} />
              <ApplicationDetail label="Validity" value={validityLabel(proof)} />
              <ApplicationDetail label="Attestation status" value={proof.attestationStatus === "attested" ? "Attested" : "Failed"} />
              <ApplicationDetail label="Proof ID" value={proof.id} />
              <ApplicationDetail label="Tenant Wallet" value={proof.tenantWallet} />
              <ApplicationDetail label="Backend verification" value={<BackendVerificationBadge verification={backendVerification} unavailable={!backendVerification && !backendVerificationError} />} />
              <ApplicationDetail label="Diagnostics" value={verificationDiagnosticsText(backendVerification)} />
              <ApplicationDetail label="Execution mode" value={isSimulationOnlyProof(proof) ? <Badge tone="amber">Simulation only</Badge> : <Badge tone="green">Backend issued</Badge>} />
              <ApplicationDetail label="Signature" value={verification?.signatureValid ? "Verified" : "Verification unavailable"} />
              <ApplicationDetail label="Integrity" value={verification ? (verification.integrityValid ? "Valid" : "Tampered") : "Verification unavailable"} />
              <ApplicationDetail label="Valid until" value={dateShort(proof.expiresAt)} />
              <ApplicationDetail label="Payload commitment" value={proof.payloadCommitment ?? "Unavailable"} />
              <ApplicationDetail
                label="On-chain status"
                value={
                  proof.onChainCommitment?.configured
                    ? proof.commitmentStatus ?? proof.onChainCommitment.status
                    : "Solana settlement not configured"
                }
              />
              <ApplicationDetail label="Solana transaction" value={<SolanaTransactionLink proof={proof} />} />
              <ApplicationDetail label="Committed at" value={proof.committedAt ? dateTimeShort(proof.committedAt) : "Unavailable"} />
              <ApplicationDetail label="Attestation" value={proof.attestation?.measurement ?? "Unavailable"} />
              <ApplicationDetail
                label="Property compatibility"
                value={`${properties.filter((property) => isProofCompatibleWithRent(proof, property.rent)).length} active listings compatible`}
              />
            </div>

            {verification && !verification.valid ? (
              <p className="mt-7 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
                Verification failed: {verification.reason}
              </p>
            ) : null}
            {!verification && backendVerificationError ? (
              <p className="mt-7 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                Verification unavailable: {backendVerificationError}
              </p>
            ) : null}

            <p className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">
              This share page never exposes income, expenses, savings, debt, bank statements, or provider records.
            </p>

            <div className="mt-7">
              <SharedPrivacyNotice />
            </div>
          </section>
        </div>
      </main>
    </Layout>
  );
}

type DiagnosticResult = {
  status: "idle" | "running" | "success" | "fail";
  reason?: string;
  metadata?: Record<string, unknown>;
  checkedAt?: string;
};

const diagnosticProfile: PrivateFinancialProfile = {
  monthlyIncome: 5200,
  monthlyExpenses: 1400,
  savings: 9000,
  monthlyDebt: 300,
};

const createDiagnosticProofRequest = async (
  tenantWallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<ProofIssueRequest> => {
  const timestamp = new Date().toISOString();
  const nonce = createRequestNonce();
  const requestMessage = createProofRequestMessage({
    tenantWallet,
    propertyId: "magicblock-diagnostic-property",
    timestamp,
    nonce,
  });
  const unsignedRequest: ProofIssueRequest = {
    propertyId: "magicblock-diagnostic-property",
    rent: 900,
    tenantWallet,
    timestamp,
    nonce,
    requestMessage,
    protectedPayload: await createProtectedTenantPayload(
      "magicblock-diagnostic-property",
      900,
      diagnosticProfile,
    ),
    requestSignature: {
      scheme: "ed25519",
      signer: tenantWallet,
      value: "",
      message: requestMessage,
    },
  };

  return signProofRequest(unsignedRequest, signMessage);
};

function MagicBlockStatusPage() {
  const { publicKey, connected, signMessage } = useWallet();
  const [backendStatus, setBackendStatus] = useState<Awaited<ReturnType<typeof getMagicBlockBackendStatus>> | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, DiagnosticResult>>({});
  const frontendStatus = getMagicBlockConfigStatus();
  const executionPublicKeyConfigured = Boolean(EXECUTION_PUBLIC_KEY);
  const currentExecutionMode =
    backendStatus?.executionMode === "magicblock-real"
      ? "magicblock-real"
      : frontendStatus.configured && executionPublicKeyConfigured
        ? "simulation"
        : "not configured";

  const refreshBackendStatus = () => {
    getMagicBlockBackendStatus()
      .then((status) => {
        setBackendStatus(status);
        setBackendError(null);
      })
      .catch((error) => {
        setBackendStatus(null);
        setBackendError(error instanceof Error ? error.message : "Backend MagicBlock status request failed.");
      });
  };

  useEffect(() => {
    refreshBackendStatus();
  }, []);

  const runDiagnostic = async (key: string, test: () => Promise<Record<string, unknown>>) => {
    setResults((current) => ({
      ...current,
      [key]: { status: "running", checkedAt: new Date().toISOString() },
    }));

    try {
      const metadata = await test();
      setResults((current) => ({
        ...current,
        [key]: {
          status: "success",
          metadata,
          checkedAt: new Date().toISOString(),
        },
      }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [key]: {
          status: "fail",
          reason: error instanceof Error ? error.message : "Diagnostic failed.",
          checkedAt: new Date().toISOString(),
        },
      }));
    }
  };

  const requireWalletSigner = () => {
    if (!connected || !publicKey || !signMessage) {
      throw new Error("Connect a wallet with message signing support before running this diagnostic.");
    }
    return {
      wallet: publicKey.toBase58(),
      sign: signMessage,
    };
  };

  const runWalletChallenge = () =>
    runDiagnostic("walletChallenge", async () => {
      const { wallet, sign } = requireWalletSigner();
      const challenge = createMagicBlockWalletChallenge(wallet);
      const signature = bs58.encode(await sign(new TextEncoder().encode(challenge.challenge)));
      return {
        wallet,
        issuedAt: challenge.issuedAt,
        challengeBytes: challenge.challenge.length,
        signatureBytesBase58: signature.length,
        signaturePreview: `${signature.slice(0, 12)}...${signature.slice(-8)}`,
        programId: magicBlockConfig.programId || "missing",
      };
    });

  const runAccessToken = () =>
    runDiagnostic("accessToken", async () => {
      const { wallet, sign } = requireWalletSigner();
      const token = await requestMagicBlockAccessToken(wallet, sign);
      if (!token.authenticated) throw new Error(token.message);
      return {
        wallet: token.wallet,
        authenticated: token.authenticated,
        expiresAt: token.expiresAt ?? "not provided",
        accessTokenPresent: Boolean(token.accessToken),
        accessTokenPreview: token.accessToken ? `${token.accessToken.slice(0, 10)}...` : "missing",
      };
    });

  const runAttestation = () =>
    runDiagnostic("attestation", async () => {
      const attestation = await requestMagicBlockAttestation();
      if (!attestation.verified) throw new Error(attestation.message);
      return {
        verified: attestation.verified,
        issuer: attestation.issuer,
        measurement: attestation.measurement ?? "not provided",
        evidencePresent: Boolean(attestation.evidence),
        checkedAt: attestation.checkedAt,
      };
    });

  const runPERAdapter = () =>
    runDiagnostic("perAdapter", async () => {
      const token = getStoredAccessToken();
      const result = await testMagicBlockPERAdapter({
        tenantWallet: publicKey?.toBase58() ?? "diagnostic-wallet",
        accessToken: token.accessToken,
        encryptedPayload: "diagnostic-encrypted-payload",
        payloadCommitment: "diagnostic-payload-commitment",
      });
      if (!result.ok) throw new Error(result.reason ?? "PER adapter returned ok=false.");
      return result.metadata ?? {};
    });

  const runProofIssuance = () =>
    runDiagnostic("proofIssuance", async () => {
      if (!executionPublicKeyConfigured) {
        throw new Error("VITE_MAGICBLOCK_EXECUTION_PUBLIC_KEY is missing; encrypted proof issuance cannot be tested.");
      }
      const { wallet, sign } = requireWalletSigner();
      const request = await createDiagnosticProofRequest(wallet, sign);
      if (request.protectedPayload.mode !== "magicblock-encrypted") {
        throw new Error("Diagnostic proof request did not produce a MagicBlock encrypted payload.");
      }
      const token = getStoredAccessToken();
      const response = await issueProofEndpoint({
        ...request,
        magicBlockAccess: {
          accessToken: token.accessToken,
        },
      });
      const metadata = response.proof.executionMetadata;
      if (metadata?.provider !== "magicblock-per" || !metadata.attestationVerified) {
        throw new Error("Proof issuance completed without verified MagicBlock PER execution metadata.");
      }
      return {
        proofId: response.proof.proofId,
        verificationValid: response.verification.valid,
        provider: metadata.provider,
        executionMode: metadata.executionMode,
        runtimeId: metadata.runtimeId,
        measurementHash: metadata.measurementHash,
        attestationVerified: metadata.attestationVerified,
      };
    });

  const configRows = [
    ["PER RPC configured", Boolean(backendStatus?.checks.perRpcConfigured || magicBlockConfig.perRpcUrl)],
    ["Attestation endpoint configured", Boolean(backendStatus?.checks.attestationConfigured || magicBlockConfig.attestationUrl)],
    ["Access token endpoint configured", Boolean(backendStatus?.checks.accessTokenConfigured || magicBlockConfig.accessTokenUrl)],
    ["Execution public key configured", executionPublicKeyConfigured],
    ["Trusted issuer configured", Boolean(backendStatus?.checks.trustedIssuerConfigured || magicBlockConfig.trustedIssuer)],
  ] as const;

  const tests = [
    ["walletChallenge", "Test wallet challenge", runWalletChallenge],
    ["accessToken", "Test access token", runAccessToken],
    ["attestation", "Test attestation endpoint", runAttestation],
    ["perAdapter", "Test PER execution adapter", runPERAdapter],
    ["proofIssuance", "Test proof issuance path", runProofIssuance],
  ] as const;

  return (
    <Layout>
      <main className="container-page py-12">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Badge tone="navy">MagicBlock diagnostics</Badge>
            <h1 className="mt-4 text-4xl font-bold text-navy-950">ProofRent MagicBlock status</h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
              This page reports configuration and exercises the real wallet, token, attestation, PER adapter, and proof issuance paths. Failures are shown as failures.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <WalletMultiButton />
            <Button variant="secondary" onClick={refreshBackendStatus}>Refresh status</Button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-navy-950">Configuration</h2>
              <Badge tone={currentExecutionMode === "magicblock-real" ? "green" : currentExecutionMode === "simulation" ? "amber" : "rose"}>
                {currentExecutionMode}
              </Badge>
            </div>
            <div className="mt-5 grid gap-3">
              {configRows.map(([label, ok]) => (
                <div key={label} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-bold text-slate-700">{label}</span>
                  <Badge tone={ok ? "green" : "rose"}>{ok ? "yes" : "no"}</Badge>
                </div>
              ))}
            </div>
            {backendError ? (
              <p className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
                Backend status failed: {backendError}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="text-xl font-bold text-navy-950">Backend metadata</h2>
            <JsonBlock
              value={{
                backendExecutionMode: backendStatus?.executionMode ?? "unavailable",
                backendConfigured: backendStatus?.configured ?? false,
                missingBackendEnv: backendStatus?.missing ?? [],
                backendMetadata: backendStatus?.metadata ?? {},
                frontendMissingEnv: frontendStatus.missing,
                wallet: publicKey?.toBase58() ?? "not connected",
              }}
            />
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-xl font-bold text-navy-950">Diagnostic tests</h2>
          <div className="mt-5 grid gap-4">
            {tests.map(([key, label, handler]) => (
              <DiagnosticTestRow
                key={key}
                label={label}
                result={results[key]}
                onRun={handler}
              />
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}

function DiagnosticTestRow({
  label,
  result,
  onRun,
}: {
  label: string;
  result?: DiagnosticResult;
  onRun: () => void;
}) {
  const status = result?.status ?? "idle";
  const tone = status === "success" ? "green" : status === "fail" ? "rose" : status === "running" ? "amber" : "slate";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-bold text-navy-950">{label}</h3>
            <Badge tone={tone}>{status}</Badge>
          </div>
          {result?.checkedAt ? <p className="mt-1 text-xs font-bold text-slate-500">{dateTimeShort(result.checkedAt)}</p> : null}
        </div>
        <Button onClick={onRun} disabled={status === "running"} variant="secondary">
          Run test <ServerCog className="h-4 w-4" />
        </Button>
      </div>
      {result?.reason ? (
        <p className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          {result.reason}
        </p>
      ) : null}
      {result?.metadata ? <JsonBlock value={result.metadata} /> : null}
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-4 max-h-80 overflow-auto rounded-2xl border border-slate-200 bg-navy-950 p-4 text-xs font-semibold leading-5 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function App() {
  useEffect(() => {
    ensureSeedData();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/properties" element={<PropertiesPage />} />
      <Route path="/architecture" element={<ArchitecturePage />} />
      <Route path="/security" element={<SecurityPage />} />
      <Route path="/lifecycle" element={<LifecyclePage />} />
      <Route path="/magicblock-status" element={<MagicBlockStatusPage />} />
      <Route path="/property/:id" element={<PropertyPage />} />
      <Route path="/verify/:propertyId" element={<VerifyPage />} />
      <Route path="/tenant/passport" element={<TenantPassportDashboardPage />} />
      <Route path="/tenant/result/:proofId" element={<TenantResultPage />} />
      <Route path="/tenant/proof/:proofId" element={<TenantProofPage />} />
      <Route path="/landlord" element={<LandlordPage />} />
      <Route path="/landlord/application/:id" element={<LandlordApplicationPage />} />
      <Route path="/verify-proof/:proofId" element={<PublicProofPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
