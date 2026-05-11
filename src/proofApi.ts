import type { Proof } from "./types";

export type PrivateFinancialProfile = {
  monthlyIncome: number;
  monthlyExpenses: number;
  savings: number;
  monthlyDebt: number;
};

export type LocalPlaintextTenantPayload = {
  mode: "local-plaintext-demo";
  payloadCommitment: string;
  encryptionContext: "local-plaintext-demo";
  plaintextProfile: PrivateFinancialProfile;
};

export type MagicBlockEncryptedTenantPayload = {
  mode: "magicblock-encrypted";
  payloadCommitment: string;
  encryptionContext: "magicblock-rsa-oaep-sha256";
  encryptedPayload: string;
  encryptionPublicKey: string;
};

export type ProtectedTenantPayload = LocalPlaintextTenantPayload | MagicBlockEncryptedTenantPayload;

export type ProofRequestSignature = {
  scheme: "ed25519";
  signer: string;
  value: string;
  message?: string;
};

export type ProofIssueRequest = {
  propertyId: string;
  rent: number;
  tenantWallet: string;
  timestamp: string;
  nonce: string;
  requestMessage: string;
  protectedPayload: ProtectedTenantPayload;
  requestSignature: ProofRequestSignature;
  magicBlockAccess?: {
    accessToken?: string;
    permissionGroup?: string;
  };
};

export type ProofVerificationResult = {
  valid: boolean;
  reason: string;
  diagnostics: string[];
  expired: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  proofHashValid: boolean;
  attestationSignatureValid: boolean;
  attestationExpired: boolean;
  verificationStatus: NonNullable<Proof["attestation"]>["verificationStatus"];
  revoked: boolean;
  trustedIssuerValid: boolean;
  onChainCommitmentConfigured: boolean;
  onChainCommitmentValid: boolean;
  onChainCommitmentStatus: NonNullable<Proof["onChainCommitment"]>["status"];
};

type ProofIssueResponse = {
  proof: Proof;
  attestationMetadata: Proof["attestation"];
  verification: ProofVerificationResult;
  validityPeriod: {
    issuedAt: string;
    expiresAt: string;
    validDays: number;
  };
};

const configuredApiBase = (import.meta.env.VITE_PROOFRENT_API_URL ?? "").trim().replace(/\/$/, "");

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const getApiBase = () => {
  if (!configuredApiBase) return "";
  if (typeof window === "undefined") return configuredApiBase;

  const configuredUrl = new URL(configuredApiBase, window.location.origin);
  const currentHostIsLocal = isLocalHost(window.location.hostname);
  const configuredHostIsLocal = isLocalHost(configuredUrl.hostname);

  return !currentHostIsLocal && configuredHostIsLocal ? "" : configuredApiBase;
};

const API_BASE = getApiBase();

const postJson = async <T,>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `ProofRent API request failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
};

export const issueProof = (request: ProofIssueRequest) =>
  postJson<ProofIssueResponse>("/api/proofs/issue", request);

export const verifyProof = (proof: Proof) =>
  postJson<{ verification: ProofVerificationResult }>("/api/proofs/verify", { proof });

const getJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `ProofRent API request failed with ${response.status}.`);
  }
  return response.json() as Promise<T>;
};

export const verifySharedProof = (proof: Proof) =>
  postJson<{
    proofId: string;
    verification: ProofVerificationResult;
    badges: Record<"signed" | "verified" | "untampered" | "active" | "attested", boolean>;
  }>(`/api/proofs/${proof.proofId || proof.id}/verify`, { proof });

export const verifyAttestation = (proof: Proof) =>
  postJson<{
    proofId: string;
    attested: boolean;
    provider: string;
    measurement: string;
  }>(`/api/proofs/${proof.proofId || proof.id}/attestation/verify`, { proof });

export const revokeProof = (proofId: string, reason: string) =>
  postJson<{ revoked: boolean; proofId: string }>(`/api/proofs/${proofId}/revoke`, { reason });

export const revokeProofById = (proofId: string, reason: string) =>
  postJson<{ revoked: boolean; proofId: string }>("/api/proofs/revoke", { proofId, reason });

export const getProofStatus = (proofId: string) =>
  getJson<{ proofId: string; status: Proof["validity"]; verification: ProofVerificationResult }>(
    `/api/proofs/${proofId}/status`,
  );

export const getPublicProof = (proofId: string) =>
  getJson<{ proof: Proof; verification: ProofVerificationResult }>(`/api/proofs/${proofId}/public`);

export type MagicBlockBackendStatus = {
  configured: boolean;
  executionMode: "magicblock-real" | "not configured";
  checks: {
    perRpcConfigured: boolean;
    attestationConfigured: boolean;
    accessTokenConfigured: boolean;
    trustedIssuerConfigured: boolean;
  };
  metadata: Record<string, unknown>;
  missing: string[];
};

export const getMagicBlockBackendStatus = () =>
  getJson<MagicBlockBackendStatus>("/api/magicblock/status");

export const testMagicBlockPERAdapter = (body: unknown) =>
  postJson<{
    ok: boolean;
    executionMode?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }>("/api/magicblock/test/per-adapter", body);
