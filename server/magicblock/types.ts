import type { Proof } from "../../src/types.js";

export type MagicBlockAdapterMode = "magicblock-real" | "simulation";

export type MagicBlockServerConfig = {
  perRpcUrl?: string;
  attestationUrl?: string;
  accessTokenUrl?: string;
  solanaRpcUrl?: string;
  programId?: string;
  trustedIssuer?: string;
};

export type TenantAuthenticationResult = {
  mode: MagicBlockAdapterMode;
  accessToken: string;
  permissionGroup: string;
  expiresAt: string;
};

export type PERAttestationResult = {
  mode: MagicBlockAdapterMode;
  attestationVerified: boolean;
  tdxQuoteHash: string;
  measurementHash: string;
  runtimeId: string;
};

export type PrivateProofJobPayload = {
  propertyId: string;
  rent: number;
  tenantWallet: string;
  encryptedPayload: unknown;
  payloadCommitment?: string;
  accessToken?: string;
  permissionGroup?: string;
};

export type PrivateProofJobResult = {
  mode: MagicBlockAdapterMode;
  executionMode: MagicBlockAdapterMode;
  runtimeId: string;
  measurementHash: string;
  proofResult: Pick<Proof, "checks" | "score" | "status" | "riskLevel" | "riskCategory" | "compatibleRentRange">;
  executionReceipt: {
    jobId: string;
    runtimeId: string;
    issuedAt: string;
    provider: "magicblock-per" | "local-simulation";
  };
  attestationEvidence: {
    attestationVerified: boolean;
    tdxQuoteHash: string;
    measurementHash: string;
    runtimeId: string;
  };
};

export type ProofCommitmentSettlement = {
  mode: MagicBlockAdapterMode;
  transactionSignature?: string;
  slot?: number;
  commitmentAddress?: string;
};

export type ProofCommitmentStatus = {
  mode: MagicBlockAdapterMode;
  exists: boolean;
  revoked: boolean;
  expiresAt: string;
};
