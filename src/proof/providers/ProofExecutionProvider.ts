import type { Attestation, Proof } from "../../types";
import type { ProofRequestSignature, ProtectedTenantPayload } from "../../proofApi";
import type { MagicBlockAttestationStatus } from "../../magicblock/types";

export type ProofExecutionProviderName = "magicblock-per" | "local-simulation";

export type ProofExecutionMetadata = {
  provider: ProofExecutionProviderName;
  executionMode?: "magicblock-real" | "simulation";
  runtimeId?: string;
  measurementHash?: string;
  perRpcUrl?: string;
  attestationVerified: boolean;
  accessTokenUsed: boolean;
  executionEnvironment: string;
  issuedAt: string;
};

export type PrivateVerificationInput = {
  propertyId: string;
  rent: number;
  tenantWallet: string;
  timestamp: string;
  nonce: string;
  requestMessage: string;
  encryptedPayload: ProtectedTenantPayload;
  requestSignature: ProofRequestSignature;
  accessToken?: string;
  attestationSession?: MagicBlockAttestationStatus;
};

export type PrivateVerificationResult = {
  proof: Proof;
  attestation: Attestation | undefined;
  executionMetadata: ProofExecutionMetadata;
};

export interface ProofExecutionProvider {
  readonly provider: ProofExecutionProviderName;
  canExecute(input: PrivateVerificationInput): boolean;
  executePrivateVerification(input: PrivateVerificationInput): Promise<PrivateVerificationResult>;
}

export const providerDisplayName = (provider: ProofExecutionProviderName) =>
  provider === "magicblock-per" ? "Executed via MagicBlock PER" : "Simulated local confidential execution";
