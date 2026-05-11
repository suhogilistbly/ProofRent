import { createHash } from "node:crypto";
import { authenticateTenantAccess, createSimulationId, getMagicBlockMode, getMagicBlockServerConfig } from "./accessControl.js";
import { verifyMagicBlockPERAttestation } from "./attestationVerifier.js";
import type {
  MagicBlockServerConfig,
  PERAttestationResult,
  PrivateProofJobPayload,
  PrivateProofJobResult,
  ProofCommitmentSettlement,
  ProofCommitmentStatus,
  TenantAuthenticationResult,
} from "./types.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const addDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

export class MagicBlockPERAdapter {
  private readonly config: MagicBlockServerConfig;
  private readonly commitmentStore = new Map<string, ProofCommitmentStatus>();

  constructor(config: MagicBlockServerConfig = getMagicBlockServerConfig()) {
    this.config = config;
  }

  private get mode() {
    return getMagicBlockMode(this.config);
  }

  async authenticateTenant(wallet: string, signedChallenge: string): Promise<TenantAuthenticationResult> {
    return authenticateTenantAccess(wallet, signedChallenge, this.config);
  }

  async verifyPERAttestation(challenge: string): Promise<PERAttestationResult> {
    return verifyMagicBlockPERAttestation(challenge, this.config);
  }

  async executePrivateProofJob(payload: PrivateProofJobPayload): Promise<PrivateProofJobResult> {
    if (this.mode === "magicblock-real") {
      // MagicBlock PER RPC call happens here. Submit encrypted private state, access token,
      // permission group, and policy inputs to the PER runtime; receive only sanitized proof outputs.
      const response = await fetch(this.config.perRpcUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(payload.accessToken ? { Authorization: `Bearer ${payload.accessToken}` } : {}),
        },
        body: JSON.stringify({
          method: "proofrent_executePrivateProofJob",
          params: {
            propertyId: payload.propertyId,
            rent: payload.rent,
            tenantWallet: payload.tenantWallet,
            encryptedPayload: payload.encryptedPayload,
            payloadCommitment: payload.payloadCommitment,
            permissionGroup: payload.permissionGroup,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`MagicBlock PER proof job failed with ${response.status}.`);
      }

      const body = (await response.json()) as Partial<PrivateProofJobResult>;
      const runtimeId = String(body.runtimeId ?? body.executionReceipt?.runtimeId ?? body.attestationEvidence?.runtimeId ?? "");
      const measurementHash = String(body.measurementHash ?? body.attestationEvidence?.measurementHash ?? "");

      return {
        ...body,
        mode: "magicblock-real",
        executionMode: "magicblock-real",
        runtimeId,
        measurementHash,
        executionReceipt: {
          ...body.executionReceipt!,
          runtimeId,
          provider: "magicblock-per",
        },
        attestationEvidence: {
          ...body.attestationEvidence!,
          runtimeId,
          measurementHash,
        },
      } as PrivateProofJobResult;
    }

    const runtimeId = createSimulationId("simulation_runtime");
    const measurementHash = `simulation_measurement_${hash(`measurement:${JSON.stringify(payload)}`).slice(0, 32)}`;

    return {
      mode: "simulation",
      executionMode: "simulation",
      runtimeId,
      measurementHash,
      proofResult: {
        checks: {
          incomeCheck: "failed",
          cashflowCheck: "failed",
          savingsCheck: "failed",
          debtCheck: "failed",
        },
        score: 0,
        status: "Not Verified",
        riskLevel: "high",
        riskCategory: "high",
        compatibleRentRange: {
          min: 0,
          max: 0,
        },
      },
      executionReceipt: {
        jobId: createSimulationId("simulation_job"),
        runtimeId,
        issuedAt: new Date().toISOString(),
        provider: "local-simulation",
      },
      attestationEvidence: {
        attestationVerified: false,
        tdxQuoteHash: `simulation_quote_${hash(JSON.stringify(payload)).slice(0, 32)}`,
        measurementHash,
        runtimeId,
      },
    };
  }

  async settleProofCommitment(proofHash: string): Promise<ProofCommitmentSettlement> {
    if (this.mode === "magicblock-real") {
      // Solana state is settled here. Send the proof commitment transaction to the ProofRent
      // registry/verifier program and return the confirmed signature, slot, and account address.
      const response = await fetch(this.config.solanaRpcUrl ?? this.config.perRpcUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "proofrent_settleProofCommitment",
          params: {
            programId: this.config.programId,
            proofHash,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Proof commitment settlement failed with ${response.status}.`);
      }

      return (await response.json()) as ProofCommitmentSettlement;
    }

    const status: ProofCommitmentStatus = {
      mode: "simulation",
      exists: true,
      revoked: false,
      expiresAt: addDays(30),
    };
    this.commitmentStore.set(proofHash, status);

    return {
      mode: "simulation",
    };
  }

  async verifyProofCommitment(proofHash: string): Promise<ProofCommitmentStatus> {
    if (this.mode === "magicblock-real") {
      // Solana commitment lookup happens here. Read the ProofRent registry/verifier account
      // and confirm the proof hash exists, is not revoked, and has not expired.
      const response = await fetch(this.config.solanaRpcUrl ?? this.config.perRpcUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "proofrent_verifyProofCommitment",
          params: {
            programId: this.config.programId,
            proofHash,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Proof commitment lookup failed with ${response.status}.`);
      }

      return (await response.json()) as ProofCommitmentStatus;
    }

    return (
      this.commitmentStore.get(proofHash) ?? {
        mode: "simulation",
        exists: false,
        revoked: false,
        expiresAt: "",
      }
    );
  }
}
