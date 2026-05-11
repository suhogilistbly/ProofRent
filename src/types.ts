export type CheckStatus = "passed" | "failed";

export type ProofSignature = {
  scheme: "ed25519";
  signer: string;
  value: string;
  message: string;
};

export type AttestationVerificationStatus =
  | "verified"
  | "invalid_signature"
  | "expired"
  | "tampered"
  | "invalid_state";

export type Attestation = {
  attestationId: string;
  proofHash: string;
  attestationHash?: string;
  issuer: string;
  issuerPublicKey?: string;
  issuedAt: string;
  expiresAt: string;
  executionEnvironment: string;
  signature: ProofSignature;
  attestationSignature?: ProofSignature;
  verificationStatus: AttestationVerificationStatus;
  provider?: string;
  quoteId?: string;
  measurement?: string;
};

export type Property = {
  id: string;
  title: string;
  location: string;
  rent: number;
  description: string;
  image: string;
  requirements: string[];
};

export type CanonicalProofPayload = {
  proofId: string;
  propertyId: string;
  status: "Tenant Verified" | "Not Verified";
  riskLevel: "low" | "medium" | "high";
  score: number;
  validUntil: string;
  createdAt: string;
  checks: {
    incomeCheck: CheckStatus;
    cashflowCheck: CheckStatus;
    savingsCheck: CheckStatus;
    debtCheck: CheckStatus;
  };
  issuer: string;
  executionMode: string;
};

export type Proof = {
  id: string;
  proofId: string;
  canonicalPayload?: CanonicalProofPayload;
  signedPayload?: CanonicalProofPayload;
  tenantWallet: string;
  propertyId: string;
  propertyIds: string[];
  compatibleRentRange: {
    min: number;
    max: number;
  };
  issuedAt: string;
  expiresAt: string;
  status: "Tenant Verified" | "Not Verified";
  riskLevel: "low" | "medium" | "high";
  riskCategory: "low" | "medium" | "high";
  score: number;
  validity: "active" | "expired" | "revoked";
  attestationStatus: "attested" | "failed";
  revokedAt?: string;
  revocationReason?: string;
  issuerPublicKey?: string;
  proofHash?: string;
  onChainCommitment?: {
    configured: boolean;
    status: "not_configured" | "settled" | "missing" | "revoked" | "expired" | "failed";
    transactionSignature?: string;
    slot?: number;
    commitmentAddress?: string;
    committedAt?: string;
    settlementType?: "program" | "memo";
    reason?: string;
  };
  solanaTxSignature?: string;
  commitmentStatus?: "not_configured" | "settled" | "missing" | "revoked" | "expired" | "failed";
  committedAt?: string;
  payloadCommitment?: string;
  executionProvider?: string;
  executionMetadata?: {
    provider: "magicblock-per" | "local-simulation";
    executionMode?: "magicblock-real" | "simulation";
    runtimeId?: string;
    measurementHash?: string;
    perRpcUrl?: string;
    attestationVerified: boolean;
    accessTokenUsed: boolean;
    executionEnvironment: string;
    issuedAt: string;
  };
  attestation?: Attestation;
  signature?: ProofSignature;
  issuerSignature?: ProofSignature;
  verifierProgram?: string;
  selectiveDisclosure?: string[];
  shareUrlPath?: string;
  validUntil: string;
  createdAt: string;
  checks: {
    incomeCheck: CheckStatus;
    cashflowCheck: CheckStatus;
    savingsCheck: CheckStatus;
    debtCheck: CheckStatus;
  };
};

export type Application = {
  id: string;
  propertyId: string;
  proofId: string;
  status: "pending" | "accepted" | "rejected";
  submittedAt: string;
  contactUnlocked: boolean;
  handoffMethod?: string;
};
