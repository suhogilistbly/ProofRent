import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  EyeOff,
  FileCheck2,
  KeyRound,
  Layers3,
  Lock,
  ServerCog,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Badge, Button } from "./ui";
import { requestMagicBlockAttestation } from "./magicblock/attestationClient";
import { getMagicBlockConfigStatus, magicBlockConfig } from "./magicblock/magicblockConfig";
import { getMagicBlockRuntimeStatus } from "./magicblock/magicblockClient";
import type { MagicBlockRuntimeStatus } from "./magicblock/types";

function PageShell({ children }: { children: React.ReactNode }) {
  return <main className="container-page py-12">{children}</main>;
}

function Hero({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
      <div>
        <Badge tone="green">{eyebrow}</Badge>
        <h1 className="mt-4 text-4xl font-bold leading-tight text-navy-950 md:text-5xl">{title}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">{body}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="grid gap-3 sm:grid-cols-3">
          <ArchitectureTile title="Frontend" text="Wallet, encryption, UX" icon={<WalletCards className="h-5 w-5" />} />
          <ArchitectureTile title="Execution" text="Risk score, proof, attestation" icon={<ServerCog className="h-5 w-5" />} />
          <ArchitectureTile title="Verification" text="Integrity, hash, expiry and signatures" icon={<ShieldCheck className="h-5 w-5" />} />
        </div>
      </div>
    </section>
  );
}

function ArchitectureTile({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-verified-700 shadow-card">{icon}</div>
      <h3 className="mt-4 text-base font-bold text-navy-950">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-verified-700">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold text-navy-950">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function FlowDiagram({
  steps,
}: {
  steps: Array<{ title: string; body: string; icon: React.ReactNode }>;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step.title} className="flex gap-3 lg:block">
          <div className="card flex flex-1 flex-col p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-verified-50 text-verified-700">{step.icon}</div>
              <span className="text-sm font-bold text-slate-400">{index + 1}</span>
            </div>
            <h3 className="mt-4 text-base font-bold text-navy-950">{step.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{step.body}</p>
          </div>
          {index < steps.length - 1 ? (
            <div className="hidden items-center justify-center text-slate-300 lg:flex">
              <ArrowRight className="h-5 w-5" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CapabilityGrid({
  items,
}: {
  items: Array<{ title: string; body: string }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
          <CheckCircle2 className="h-5 w-5 text-verified-700" />
          <h3 className="mt-4 text-lg font-bold text-navy-950">{item.title}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

export function ArchitecturePage() {
  return (
    <PageShell>
      <Hero
        eyebrow="MagicBlock Privacy Track architecture"
        title="ProofRent is split into client UX, simulated confidential execution, and Solana verification."
        body="The browser is not presented as a trust boundary. It prepares encrypted MagicBlock payloads when an execution key is configured, or an explicitly labeled plaintext local demo payload otherwise."
      />

      <MagicBlockDiagnosticPanel />

      <Section eyebrow="Boundaries" title="Three-layer architecture">
        <CapabilityGrid
          items={[
            {
              title: "Frontend client",
              body: "Connects wallet, collects consent, encrypts tenant payloads, submits proof requests, and renders landlord and proof reuse workflows.",
            },
            {
              title: "Simulated execution service",
              body: "Owns tenant financial evaluation, affordability checks, risk scoring, proof generation, local attestation-ready metadata, and proof signing for the MVP.",
            },
            {
              title: "Proof verification layer",
              body: "Publishes sanitized proof state, checks signatures and attestation metadata, and gives landlords a Solana-native verification surface.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Abstractions" title="Provider interfaces">
        <div className="grid gap-4 lg:grid-cols-3">
          {[
            ["ProofExecutionProvider", "Submits protected payloads to a MagicBlock-compatible execution adapter and receives a sanitized execution result."],
            ["AttestationProvider", "Creates a signed attestation-ready object binding proofHash to issuer, expiry and execution-environment metadata."],
            ["VerificationProvider", "Checks integrity, expiration, proof hash consistency, proof signature and attestation signature."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl bg-navy-950 p-5 text-white shadow-card">
              <p className="font-mono text-sm text-verified-100">{title}</p>
              <p className="mt-4 text-sm font-semibold leading-6 text-slate-300">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Data path" title="MagicBlock-compatible payload flow">
        <FlowDiagram
          steps={[
            { title: "Tenant data", body: "Income, expenses, savings, debt and rent target remain tenant-side inputs.", icon: <DatabaseZap className="h-5 w-5" /> },
            { title: "Wallet consent", body: "Tenant wallet authorizes a proof request and demo encryption context.", icon: <WalletCards className="h-5 w-5" /> },
            { title: "Protected payload", body: "Frontend submits encrypted data when configured, otherwise an explicitly labeled plaintext local demo payload.", icon: <Lock className="h-5 w-5" /> },
            { title: "PER-ready adapter", body: "Simulated confidential execution evaluates the payload and emits sanitized proof fields.", icon: <Layers3 className="h-5 w-5" /> },
            { title: "Verifier", body: "Landlords verify integrity, expiration, proof hash consistency and signatures.", icon: <ShieldCheck className="h-5 w-5" /> },
          ]}
        />
      </Section>
    </PageShell>
  );
}

function MagicBlockDiagnosticPanel() {
  const [runtimeStatus, setRuntimeStatus] = useState<MagicBlockRuntimeStatus>(() => getMagicBlockRuntimeStatus());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configStatus = getMagicBlockConfigStatus();

  useEffect(() => {
    setRuntimeStatus(getMagicBlockRuntimeStatus());
  }, []);

  const runAttestationCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      await requestMagicBlockAttestation();
      setRuntimeStatus(getMagicBlockRuntimeStatus());
    } catch (event) {
      setError(event instanceof Error ? event.message : "MagicBlock attestation check failed.");
      setRuntimeStatus(getMagicBlockRuntimeStatus());
    } finally {
      setChecking(false);
    }
  };

  const rows = [
    ["Solana RPC", magicBlockConfig.solanaRpcUrl || "Missing"],
    ["PER RPC", magicBlockConfig.perRpcUrl || "Missing"],
    ["Attestation URL", magicBlockConfig.attestationUrl || "Missing"],
    ["Access token URL", magicBlockConfig.accessTokenUrl || "Missing"],
    ["Program ID", magicBlockConfig.programId || "Missing"],
    ["Trusted issuer", magicBlockConfig.trustedIssuer || "Missing"],
  ] as const;

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={runtimeStatus.connected ? "green" : configStatus.configured ? "amber" : "rose"}>
              {runtimeStatus.connected ? "MagicBlock connected" : "MagicBlock diagnostics"}
            </Badge>
            <Badge tone={runtimeStatus.mode === "magicblock" ? "green" : "amber"}>
              {runtimeStatus.mode === "magicblock" ? "PER mode" : "Simulation mode"}
            </Badge>
          </div>
          <h2 className="mt-4 text-2xl font-bold text-navy-950">MagicBlock integration boundary</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            {runtimeStatus.message}
          </p>
        </div>
        <Button onClick={runAttestationCheck} disabled={!configStatus.configured || checking} variant="secondary">
          {checking ? "Checking..." : "Check attestation"} <ShieldCheck className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <ArchitectureTile
          title="Configuration"
          text={configStatus.configured ? "All MagicBlock client env vars are present." : `Missing: ${configStatus.missing.join(", ") || "unknown"}.`}
          icon={configStatus.configured ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        />
        <ArchitectureTile
          title="Attestation"
          text={runtimeStatus.attestation.verified ? `Verified issuer ${runtimeStatus.attestation.issuer}.` : runtimeStatus.attestation.message}
          icon={runtimeStatus.attestation.verified ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        />
        <ArchitectureTile
          title="Access token"
          text={runtimeStatus.accessToken.authenticated ? "Wallet challenge succeeded and a PER access token is stored." : runtimeStatus.accessToken.message}
          icon={runtimeStatus.accessToken.authenticated ? <KeyRound className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
            <p className="mt-2 break-words text-sm font-bold text-navy-950">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SecurityPage() {
  return (
    <PageShell>
      <Hero
        eyebrow="Security model"
        title="ProofRent is MagicBlock-compatible today, with simulated confidential execution."
        body="The MVP is intentionally honest: local adapters simulate the protocol shape, signed proofs and signed attestation-ready metadata are real, and production privacy would require MagicBlock PER integration plus verifier-checked runtime evidence."
      />

      <Section eyebrow="Technical sections" title="Privacy-preserving proof architecture">
        <CapabilityGrid
          items={[
            {
              title: "Private Ephemeral Rollups",
              body: "ProofRent is structured so a future MagicBlock PER can handle short-lived private state transitions before proofs or commitments settle back to Solana.",
            },
            {
              title: "Attestation-ready flow",
              body: "This MVP uses a local signed metadata object that binds proofHash, issuer, environment, issue time and expiry. It is not production runtime attestation.",
            },
            {
              title: "Simulated confidential execution",
              body: "Financial signals are evaluated inside the local proof service for the demo. The public app receives compatible rent range, risk category, validity, proof hash and attestation status.",
            },
            {
              title: "Reusable proofs",
              body: "A tenant can reuse a still-valid proof across properties when the rent threshold and disclosure policy remain compatible.",
            },
            {
              title: "Selective disclosure",
              body: "Landlords see eligibility, risk tier, validity, property compatibility and attestation metadata, not income, debt, savings or provider records.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Attestation" title="Attestation-ready issuance">
        <FlowDiagram
          steps={[
            { title: "Execution adapter", body: "Local service models the boundary where a measured evaluator would run in production.", icon: <ServerCog className="h-5 w-5" /> },
            { title: "Tenant payload", body: "Encrypted MagicBlock payloads or labeled plaintext demo payloads enter the execution adapter.", icon: <Lock className="h-5 w-5" /> },
            { title: "Proof hash", body: "Verifier-facing payload is hashed before local attestation-ready metadata is issued.", icon: <KeyRound className="h-5 w-5" /> },
            { title: "Signed metadata", body: "Issuer signs attestationId, proofHash, environment, issue time and expiry.", icon: <FileCheck2 className="h-5 w-5" /> },
            { title: "Public check", body: "Verification layer checks integrity, hash consistency, expiration and signatures.", icon: <ShieldCheck className="h-5 w-5" /> },
          ]}
        />
      </Section>

      <Section eyebrow="Implementation honesty" title="What is currently simulated vs production-ready">
        <div className="grid gap-4 lg:grid-cols-3">
          <ArchitectureTile title="Real in this MVP" text="Signed proofs, signed attestation objects, proof hashes, expiration checks, tamper detection, sanitized landlord views and reusable proof UX." icon={<CheckCircle2 className="h-5 w-5" />} />
          <ArchitectureTile title="Simulated today" text="The local MVP simulates confidential execution using clearly labeled plaintext demo inputs, plus production runtime attestation, PER scheduling and on-chain verifier-call placeholders." icon={<EyeOff className="h-5 w-5" />} />
          <ArchitectureTile title="Production-ready shape" text="The code has a MagicBlock-compatible architecture, provider seams, proof hashing, signature checks, expiry checks and selective landlord disclosure." icon={<Layers3 className="h-5 w-5" />} />
        </div>
      </Section>

      <Section eyebrow="Roadmap" title="Roadmap to MagicBlock PER integration">
        <FlowDiagram
          steps={[
            { title: "PER job adapter", body: "Replace local evaluation with a MagicBlock PER job submission and result callback.", icon: <Layers3 className="h-5 w-5" /> },
            { title: "Key handoff", body: "Encrypt payloads to production-managed execution keys instead of using local plaintext demo inputs.", icon: <Lock className="h-5 w-5" /> },
            { title: "Runtime evidence", body: "Attach verifier-checkable runtime evidence to the signed attestation-ready metadata.", icon: <FileCheck2 className="h-5 w-5" /> },
            { title: "Solana verifier", body: "Settle proof commitments and revocation state through a deployed verifier program.", icon: <ShieldCheck className="h-5 w-5" /> },
            { title: "Audit package", body: "Document threat model, residual metadata leakage, key rotation, replay handling and operational controls.", icon: <KeyRound className="h-5 w-5" /> },
          ]}
        />
      </Section>
    </PageShell>
  );
}

export function LifecyclePage() {
  return (
    <PageShell>
      <Hero
        eyebrow="Proof lifecycle"
        title="From tenant financial data to landlord verification without document exposure."
        body="The lifecycle page shows how tenant data becomes a protected request, an execution result, an attestation-ready proof, and finally a landlord-verifiable decision."
      />

      <Section eyebrow="Financial data" title="Tenant financial data diagram">
        <FlowDiagram
          steps={[
            { title: "Bank data", body: "Balances, inflows and expenses enter tenant-controlled preparation.", icon: <DatabaseZap className="h-5 w-5" /> },
            { title: "Payroll", body: "Income stability is normalized into proof inputs.", icon: <FileCheck2 className="h-5 w-5" /> },
            { title: "Wallet", body: "Tenant signs consent and binds the request to a wallet identity.", icon: <WalletCards className="h-5 w-5" /> },
            { title: "Policy", body: "Rent threshold and disclosure policy are attached.", icon: <ShieldCheck className="h-5 w-5" /> },
            { title: "Payload", body: "Raw values become encrypted payloads when configured, or explicitly labeled plaintext demo inputs locally.", icon: <Lock className="h-5 w-5" /> },
          ]}
        />
      </Section>

      <Section eyebrow="Execution" title="Simulated confidential execution diagram">
        <FlowDiagram
          steps={[
            { title: "Receive request", body: "Service receives the protected payload, rent target and wallet consent.", icon: <Lock className="h-5 w-5" /> },
            { title: "Evaluate", body: "Affordability, cashflow, reserves and debt checks run in the local simulated execution boundary.", icon: <ServerCog className="h-5 w-5" /> },
            { title: "Score", body: "Risk score is derived without returning raw financial fields.", icon: <DatabaseZap className="h-5 w-5" /> },
            { title: "Attest", body: "Signed attestation-ready metadata binds proof hash to execution-environment details.", icon: <KeyRound className="h-5 w-5" /> },
            { title: "Sign", body: "Verifier-facing proof commitment is signed for reuse.", icon: <FileCheck2 className="h-5 w-5" /> },
          ]}
        />
      </Section>

      <Section eyebrow="Landlord" title="Landlord verification diagram">
        <FlowDiagram
          steps={[
            { title: "Proof link", body: "Tenant shares proof or submits it with an application.", icon: <FileCheck2 className="h-5 w-5" /> },
            { title: "Public fields", body: "Landlord sees compatible rent range, risk, validity and attestation status.", icon: <EyeOff className="h-5 w-5" /> },
            { title: "Signature", body: "Verification provider confirms proof commitment signer.", icon: <KeyRound className="h-5 w-5" /> },
            { title: "Attestation", body: "Proof hash, local metadata signature and execution-environment fields are checked.", icon: <ServerCog className="h-5 w-5" /> },
            { title: "Decision", body: "Landlord accepts or rejects without receiving documents.", icon: <ShieldCheck className="h-5 w-5" /> },
          ]}
        />
      </Section>

      <div className="mt-12 rounded-2xl border border-verified-100 bg-verified-50 p-6">
        <h2 className="text-2xl font-bold text-navy-950">Try the flow</h2>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-700">
          Generate a proof, inspect the attestation fields on the result, then open the landlord verifier view to see the selective disclosure boundary.
        </p>
        <Link to="/properties" className="mt-5 inline-flex">
          <Button>
            Start proof <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </PageShell>
  );
}
