import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Proof } from "./types";

const encoder = new TextEncoder();
const trustedIssuerPublicKey = import.meta.env.VITE_PROOFRENT_TRUSTED_ISSUER?.trim() ?? "";

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

export type IssuedProofPackageValidation = {
  valid: boolean;
  missingFields: string[];
  failedStage: "canonical-payload" | "proof-signing" | "attestation" | "issue-output" | null;
  signingCompleted: boolean;
  attestationCompleted: boolean;
};

export type ProofVerificationResult = {
  valid: boolean;
  reason: string;
  diagnostics?: string[];
  integrityDiagnostics?: {
    expectedHash: string;
    actualHash: string;
    mismatchedFields: string[];
    signedPayloadKeys: string[];
    receivedPayloadKeys: string[];
    signedPayload: string;
  };
  expired: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  proofHashValid: boolean;
  attestationSignatureValid: boolean;
  attestationExpired: boolean;
  verificationStatus: NonNullable<Proof["attestation"]>["verificationStatus"];
  revoked?: boolean;
  trustedIssuerValid: boolean;
};

const ordered = <T extends Record<string, unknown>>(value: T): T =>
  Object.keys(value)
    .sort()
    .reduce((result, key) => ({ ...result, [key]: value[key] }), {} as T);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const nextValue = (value as Record<string, unknown>)[key];
        if (nextValue !== undefined) result[key] = canonicalize(nextValue);
        return result;
      }, {});
  }
  return value;
};

const canonicalStringify = (value: unknown) => JSON.stringify(canonicalize(value));

export const getProofId = (proof: Pick<Proof, "id" | "proofId">) => proof.proofId || proof.id;

const hasString = (value: unknown) => typeof value === "string" && value.length > 0;

export const validateIssuedProofPackage = (proof: Proof): IssuedProofPackageValidation => {
  const attestationSignature = getAttestationSignature(proof);
  const issuerSignature = getIssuerSignature(proof);
  const requiredFields: Array<[string, unknown]> = [
    ["proofId", proof.proofId || proof.id],
    ["canonicalPayload", proof.canonicalPayload],
    ["canonicalPayload.proofId", proof.canonicalPayload?.proofId],
    ["canonicalPayload.propertyId", proof.canonicalPayload?.propertyId],
    ["canonicalPayload.status", proof.canonicalPayload?.status],
    ["canonicalPayload.riskLevel", proof.canonicalPayload?.riskLevel],
    ["canonicalPayload.score", proof.canonicalPayload?.score],
    ["canonicalPayload.validUntil", proof.canonicalPayload?.validUntil],
    ["canonicalPayload.createdAt", proof.canonicalPayload?.createdAt],
    ["canonicalPayload.checks", proof.canonicalPayload?.checks],
    ["canonicalPayload.issuer", proof.canonicalPayload?.issuer],
    ["canonicalPayload.executionMode", proof.canonicalPayload?.executionMode],
    ["proofHash", proof.proofHash],
    ["issuer", proof.issuerPublicKey],
    ["issuerSignature", issuerSignature],
    ["issuerSignature.scheme", issuerSignature?.scheme],
    ["issuerSignature.signer", issuerSignature?.signer],
    ["issuerSignature.value", issuerSignature?.value],
    ["issuerSignature.message", issuerSignature?.message],
    ["attestation", proof.attestation],
    ["attestation.attestationId", proof.attestation?.attestationId],
    ["attestation.proofHash", proof.attestation?.proofHash],
    ["attestation.issuer", proof.attestation?.issuer],
    ["attestation.issuerPublicKey", proof.attestation?.issuerPublicKey],
    ["attestation.issuedAt", proof.attestation?.issuedAt],
    ["attestation.expiresAt", proof.attestation?.expiresAt],
    ["attestation.executionEnvironment", proof.attestation?.executionEnvironment],
    ["attestation.attestationHash", proof.attestation?.attestationHash],
    ["attestationSignature", attestationSignature],
    ["attestationSignature.scheme", attestationSignature?.scheme],
    ["attestationSignature.signer", attestationSignature?.signer],
    ["attestationSignature.value", attestationSignature?.value],
    ["attestationSignature.message", attestationSignature?.message],
    ["createdAt", proof.createdAt],
    ["validUntil", proof.validUntil],
    ["checks", proof.checks],
    ["riskLevel", proof.riskLevel],
    ["status", proof.status],
  ];

  const missingFields = requiredFields
    .filter(([, value]) => value === undefined || value === null || (typeof value === "string" && value.length === 0))
    .map(([field]) => field);
  const signingCompleted =
    issuerSignature?.scheme === "ed25519" &&
    hasString(issuerSignature.signer) &&
    hasString(issuerSignature.value) &&
    hasString(issuerSignature.message);
  const attestationCompleted =
    Boolean(proof.attestation) &&
    hasString(proof.attestation?.attestationHash) &&
    attestationSignature?.scheme === "ed25519" &&
    hasString(attestationSignature.signer) &&
    hasString(attestationSignature.value) &&
    hasString(attestationSignature.message);
  const failedStage = missingFields.some((field) => field.startsWith("canonicalPayload"))
    ? "canonical-payload"
    : !signingCompleted
      ? "proof-signing"
      : !attestationCompleted
        ? "attestation"
        : missingFields.length
          ? "issue-output"
          : null;

  return {
    valid: missingFields.length === 0,
    missingFields,
    failedStage,
    signingCompleted,
    attestationCompleted,
  };
};

const proofExecutionMode = (proof: Proof) =>
  proof.executionMetadata?.executionMode ??
  proof.executionMetadata?.provider ??
  proof.executionProvider ??
  "local-simulation";

export const createCanonicalProofPayload = (proof: Proof): NonNullable<Proof["canonicalPayload"]> => ({
  proofId: getProofId(proof),
  propertyId: proof.propertyId,
  status: proof.status,
  riskLevel: proof.riskLevel,
  score: proof.score,
  validUntil: proof.validUntil || proof.expiresAt,
  createdAt: proof.createdAt || proof.issuedAt,
  checks: ordered(proof.checks),
  issuer: proof.issuerPublicKey ?? proof.signature?.signer ?? "",
  executionMode: proofExecutionMode(proof),
});

export const canonicalProofPayload = (proof: Proof) =>
  canonicalStringify(proof.canonicalPayload ?? proof.signedPayload ?? createCanonicalProofPayload(proof));

export const proofMessage = (proof: Proof) =>
  `ProofRent signed rental proof\n${canonicalProofPayload(proof)}`;

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const proofHash = (proof: Proof) => `sha512_${hex(nacl.hash(encoder.encode(proofMessage(proof))))}`;

export const attestationPayload = (attestation: NonNullable<Proof["attestation"]>) =>
  canonicalStringify(
    {
      attestationId: attestation.attestationId,
      executionEnvironment: attestation.executionEnvironment,
      expiresAt: attestation.expiresAt,
      issuedAt: attestation.issuedAt,
      issuer: attestation.issuer,
      issuerPublicKey: attestation.issuerPublicKey,
      proofHash: attestation.proofHash,
    },
  );

export const attestationMessage = (attestation: NonNullable<Proof["attestation"]>) =>
  `ProofRent simulated confidential execution attestation\n${attestationPayload(attestation)}`;

export const attestationHash = (attestation: NonNullable<Proof["attestation"]>) =>
  `sha512_${hex(nacl.hash(encoder.encode(attestationMessage(attestation))))}`;

const getProofIssuer = (proof: Proof) => proof.issuerPublicKey ?? proof.signature?.signer;
const getIssuerSignature = (proof: Proof) => proof.issuerSignature ?? proof.signature;
const getAttestationIssuer = (proof: Proof) => proof.attestation?.issuerPublicKey ?? proof.attestation?.issuer;
const getAttestationSignature = (proof: Proof) => proof.attestation?.attestationSignature ?? proof.attestation?.signature;

export const verifyTrustedIssuer = (proof: Proof, trustedIssuer = trustedIssuerPublicKey) => {
  const issuerSignature = getIssuerSignature(proof);
  const proofIssuer = getProofIssuer(proof);
  const attestationIssuer = getAttestationIssuer(proof);
  const attestationSignature = getAttestationSignature(proof);
  const effectiveTrustedIssuer = trustedIssuer || proofIssuer;

  if (!proofIssuer || !attestationIssuer || !issuerSignature?.signer || !attestationSignature?.signer) {
    return { valid: false, reason: "Proof is missing required issuer fields." };
  }
  if (!effectiveTrustedIssuer) {
    return { valid: false, reason: "Trusted issuer is not configured." };
  }
  if (proofIssuer !== effectiveTrustedIssuer || attestationIssuer !== effectiveTrustedIssuer) {
    return { valid: false, reason: "Proof was signed by an unknown issuer." };
  }
  if (issuerSignature.signer !== effectiveTrustedIssuer || attestationSignature.signer !== effectiveTrustedIssuer) {
    return { valid: false, reason: "Proof or attestation signature was not produced by the trusted issuer." };
  }
  if (proof.attestation?.issuer && proof.attestation.issuer !== effectiveTrustedIssuer) {
    return { valid: false, reason: "Attestation issuer field was modified." };
  }

  return { valid: true, reason: "Trusted issuer verified." };
};

export const signProofWithWallet = async (proof: Proof, signMessage: SignMessage): Promise<Proof["signature"]> => {
  const message = proofMessage(proof);
  const signatureBytes = await signMessage(encoder.encode(message));

  return {
    scheme: "ed25519",
    signer: proof.tenantWallet,
    value: bs58.encode(signatureBytes),
    message,
  };
};

export const validateProofIntegrity = (proof: Proof) => {
  const proofId = getProofId(proof);
  const issuerSignature = getIssuerSignature(proof);
  const requiredStringFields = [
    proofId,
    proof.tenantWallet,
    proof.propertyIds?.join(","),
    proof.issuedAt,
    proof.expiresAt,
    proof.riskCategory,
    proof.validity,
    proof.attestationStatus,
    proof.attestation?.attestationId,
    proof.attestation?.proofHash,
    proof.proofHash,
    proof.issuerPublicKey,
    proof.attestation?.issuerPublicKey ?? proof.attestation?.issuer,
    proof.attestation?.attestationHash,
    proof.attestation?.executionEnvironment,
    issuerSignature?.value,
  ];

  if (requiredStringFields.some((field) => !field || typeof field !== "string")) {
    return { valid: false, reason: "Proof is missing required attestation fields." };
  }

  if (proof.id !== proof.proofId) {
    return { valid: false, reason: "Proof ID alias does not match canonical proofId." };
  }

  const canonicalPayload = proof.canonicalPayload;
  if (!canonicalPayload) {
    return { valid: false, reason: "Proof is missing immutable canonical payload." };
  }

  if (
    canonicalPayload.proofId !== proofId ||
    canonicalPayload.propertyId !== proof.propertyId ||
    canonicalPayload.issuer !== proof.issuerPublicKey
  ) {
    return { valid: false, reason: "Canonical payload does not match proof identity fields." };
  }

  if (issuerSignature?.scheme !== "ed25519") {
    return { valid: false, reason: "Proof signature scheme is not Ed25519." };
  }

  if (proof.attestationStatus !== "attested") {
    return { valid: false, reason: "Proof attestation has not been verified." };
  }

  if (!proof.attestation) {
    return { valid: false, reason: "Proof is missing attestation metadata." };
  }

  const attestationSignature = getAttestationSignature(proof);
  if (!attestationSignature || attestationSignature.message !== attestationMessage(proof.attestation)) {
    return { valid: false, reason: "Attestation signature message does not match the attestation payload." };
  }

  if (!Array.isArray(proof.propertyIds) || typeof proof.compatibleRentRange?.max !== "number") {
    return { valid: false, reason: "Proof is missing reusable passport compatibility fields." };
  }

  if (issuerSignature.message !== proofMessage(proof)) {
    return { valid: false, reason: "Signed message does not match current proof payload." };
  }

  if (Number.isNaN(Date.parse(proof.issuedAt)) || Number.isNaN(Date.parse(proof.expiresAt))) {
    return { valid: false, reason: "Proof timestamps are invalid." };
  }

  try {
    new PublicKey(proof.tenantWallet);
    if (proof.issuerPublicKey) bs58.decode(proof.issuerPublicKey);
    bs58.decode(issuerSignature.value);
  } catch {
    return { valid: false, reason: "Proof contains an invalid wallet or signature encoding." };
  }

  return { valid: true, reason: "Proof integrity fields are complete." };
};

export const verifyProofSignature = (proof: Proof) => {
  const issuerSignature = getIssuerSignature(proof);
  if (!issuerSignature) return false;

  try {
    const publicKey = new PublicKey(issuerSignature.signer);
    const signature = bs58.decode(issuerSignature.value);
    return nacl.sign.detached.verify(encoder.encode(proofMessage(proof)), signature, publicKey.toBytes());
  } catch {
    return false;
  }
};

export const verifyAttestationSignature = (proof: Proof) => {
  const attestationSignature = getAttestationSignature(proof);
  if (!proof.attestation || !attestationSignature) return false;

  try {
    const signature = bs58.decode(attestationSignature.value);
    const signer = bs58.decode(attestationSignature.signer);
    return nacl.sign.detached.verify(encoder.encode(attestationMessage(proof.attestation)), signature, signer);
  } catch {
    return false;
  }
};

export const verifyProofAuthenticity = (proof: Proof, now = new Date()): ProofVerificationResult => {
  const integrity = validateProofIntegrity(proof);
  const expired = Date.parse(proof.expiresAt) <= now.getTime();
  const attestationExpired = proof.attestation ? Date.parse(proof.attestation.expiresAt) <= now.getTime() : true;
  const currentProofHash = proofHash(proof);
  const canonicalPayload = proof.canonicalPayload ?? proof.signedPayload ?? createCanonicalProofPayload(proof);
  const issuerSignature = getIssuerSignature(proof);
  const proofHashValid =
    Boolean(proof.attestation) &&
    proof.attestation?.proofHash === currentProofHash &&
    proof.proofHash === currentProofHash;
  const attestationSignatureValid = verifyAttestationSignature(proof);
  const attestationHashValid = proof.attestation ? proof.attestation.attestationHash === attestationHash(proof.attestation) : false;
  const trustedIssuer = verifyTrustedIssuer(proof);
  const revoked = proof.validity === "revoked" || Boolean(proof.revokedAt);
  const diagnostics = [
    `expected hash: ${currentProofHash}`,
    `actual hash: ${proof.proofHash ?? "missing"}`,
    proof.attestation?.proofHash && proof.attestation.proofHash !== currentProofHash
      ? `attestation proof hash: ${proof.attestation.proofHash}`
      : undefined,
    `signed payload: ${canonicalProofPayload(proof)}`,
    proof.proofHash && proof.proofHash !== currentProofHash ? "proof hash mismatch" : undefined,
    proof.attestation?.proofHash && proof.attestation.proofHash !== currentProofHash ? "attestation proof hash mismatch" : undefined,
    issuerSignature?.message && issuerSignature.message !== proofMessage(proof) ? "signed message mismatch" : undefined,
  ].filter((diagnostic): diagnostic is string => Boolean(diagnostic));
  const mismatchedFields = [
    proof.id !== proof.proofId ? "proofId" : undefined,
    !proof.canonicalPayload ? "canonicalPayload" : undefined,
    canonicalPayload.proofId !== getProofId(proof) ? "canonicalPayload.proofId" : undefined,
    canonicalPayload.propertyId !== proof.propertyId ? "canonicalPayload.propertyId" : undefined,
    canonicalPayload.issuer !== proof.issuerPublicKey ? "canonicalPayload.issuer" : undefined,
    proof.proofHash !== currentProofHash ? "proofHash" : undefined,
    proof.attestation?.proofHash !== currentProofHash ? "attestation.proofHash" : undefined,
    issuerSignature?.message !== proofMessage(proof) ? "issuerSignature.message" : undefined,
  ].filter((field): field is string => Boolean(field));
  const integrityDiagnostics = {
    expectedHash: currentProofHash,
    actualHash: proof.proofHash ?? "missing",
    mismatchedFields,
    signedPayloadKeys: Object.keys(canonicalPayload).sort(),
    receivedPayloadKeys: Object.keys(proof).sort(),
    signedPayload: canonicalProofPayload(proof),
  };

  if (!integrity.valid) {
    return {
      valid: false,
      reason: integrity.reason,
      expired,
      signatureValid: false,
      integrityValid: false,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "tampered",
      revoked,
      trustedIssuerValid: trustedIssuer.valid,
      diagnostics,
      integrityDiagnostics,
    };
  }

  if (!trustedIssuer.valid) {
    return {
      valid: false,
      reason: trustedIssuer.reason,
      expired,
      signatureValid: false,
      integrityValid: true,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "invalid_signature",
      revoked,
      trustedIssuerValid: false,
      diagnostics,
      integrityDiagnostics,
    };
  }

  const signatureValid = verifyProofSignature(proof);
  if (!signatureValid) {
    return {
      valid: false,
      reason: "Proof signature failed Ed25519 verification.",
      expired,
      signatureValid,
      integrityValid: true,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "invalid_signature",
      revoked,
      trustedIssuerValid: true,
      diagnostics,
      integrityDiagnostics,
    };
  }

  if (!attestationSignatureValid) {
    return {
      valid: false,
      reason: "Attestation signature failed Ed25519 verification.",
      expired,
      signatureValid,
      integrityValid: true,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "invalid_signature",
      revoked,
      trustedIssuerValid: true,
      diagnostics,
      integrityDiagnostics,
    };
  }

  if (!proofHashValid || !attestationHashValid) {
    return {
      valid: false,
      reason: "Proof hash or attestation hash does not match the signed issuer payload.",
      expired,
      signatureValid,
      integrityValid: true,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "tampered",
      revoked,
      trustedIssuerValid: true,
      diagnostics,
      integrityDiagnostics,
    };
  }

  if (expired || attestationExpired) {
    return {
      valid: false,
      reason: "Proof or attestation has expired.",
      expired,
      signatureValid,
      integrityValid: true,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "expired",
      revoked,
      trustedIssuerValid: true,
      diagnostics,
      integrityDiagnostics,
    };
  }

  if (revoked) {
    return {
      valid: false,
      reason: "Proof has been revoked.",
      expired,
      signatureValid,
      integrityValid: true,
      proofHashValid,
      attestationSignatureValid,
      attestationExpired,
      verificationStatus: "invalid_state",
      revoked,
      trustedIssuerValid: true,
      diagnostics,
      integrityDiagnostics,
    };
  }

  return {
    valid: true,
    reason: "Proof signature, integrity, attestation, expiration, and revocation status are valid.",
    expired,
    signatureValid,
    integrityValid: true,
    proofHashValid,
    attestationSignatureValid,
    attestationExpired,
    verificationStatus: "verified",
    revoked,
    trustedIssuerValid: true,
    diagnostics,
    integrityDiagnostics,
  };
};
