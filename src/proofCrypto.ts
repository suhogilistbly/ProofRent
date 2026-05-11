import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Proof } from "./types";

const encoder = new TextEncoder();
const trustedIssuerPublicKey = import.meta.env.VITE_PROOFRENT_TRUSTED_ISSUER?.trim() ?? "";

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

export type ProofVerificationResult = {
  valid: boolean;
  reason: string;
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

export const getProofId = (proof: Pick<Proof, "id" | "proofId">) => proof.proofId || proof.id;

export const canonicalProofPayload = (proof: Proof) =>
  JSON.stringify(
    ordered({
      attestationStatus: proof.attestationStatus,
      checks: ordered(proof.checks),
      compatibleRentRange: ordered(proof.compatibleRentRange),
      expiresAt: proof.expiresAt,
      issuedAt: proof.issuedAt,
      proofId: getProofId(proof),
      propertyIds: proof.propertyIds,
      riskCategory: proof.riskCategory,
      tenantWallet: proof.tenantWallet,
      issuerPublicKey: proof.issuerPublicKey,
    }),
  );

export const proofMessage = (proof: Proof) =>
  `ProofRent signed rental proof\n${canonicalProofPayload(proof)}`;

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const proofHash = (proof: Proof) => `sha512_${hex(nacl.hash(encoder.encode(proofMessage(proof))))}`;

export const attestationPayload = (attestation: NonNullable<Proof["attestation"]>) =>
  JSON.stringify(
    ordered({
      attestationId: attestation.attestationId,
      executionEnvironment: attestation.executionEnvironment,
      expiresAt: attestation.expiresAt,
      issuedAt: attestation.issuedAt,
      issuer: attestation.issuer,
      issuerPublicKey: attestation.issuerPublicKey,
      proofHash: attestation.proofHash,
    }),
  );

export const attestationMessage = (attestation: NonNullable<Proof["attestation"]>) =>
  `ProofRent simulated confidential execution attestation\n${attestationPayload(attestation)}`;

export const attestationHash = (attestation: NonNullable<Proof["attestation"]>) =>
  `sha512_${hex(nacl.hash(encoder.encode(attestationMessage(attestation))))}`;

const getProofIssuer = (proof: Proof) => proof.issuerPublicKey ?? proof.signature?.signer;
const getAttestationIssuer = (proof: Proof) => proof.attestation?.issuerPublicKey ?? proof.attestation?.issuer;
const getAttestationSignature = (proof: Proof) => proof.attestation?.attestationSignature ?? proof.attestation?.signature;

export const verifyTrustedIssuer = (proof: Proof, trustedIssuer = trustedIssuerPublicKey) => {
  const proofIssuer = getProofIssuer(proof);
  const attestationIssuer = getAttestationIssuer(proof);
  const attestationSignature = getAttestationSignature(proof);
  const effectiveTrustedIssuer = trustedIssuer || proofIssuer;

  if (!proofIssuer || !attestationIssuer || !proof.signature?.signer || !attestationSignature?.signer) {
    return { valid: false, reason: "Proof is missing required issuer fields." };
  }
  if (!effectiveTrustedIssuer) {
    return { valid: false, reason: "Trusted issuer is not configured." };
  }
  if (proofIssuer !== effectiveTrustedIssuer || attestationIssuer !== effectiveTrustedIssuer) {
    return { valid: false, reason: "Proof was signed by an unknown issuer." };
  }
  if (proof.signature.signer !== effectiveTrustedIssuer || attestationSignature.signer !== effectiveTrustedIssuer) {
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
    proof.signature?.value,
  ];

  if (requiredStringFields.some((field) => !field || typeof field !== "string")) {
    return { valid: false, reason: "Proof is missing required attestation fields." };
  }

  if (proof.id !== proof.proofId) {
    return { valid: false, reason: "Proof ID alias does not match canonical proofId." };
  }

  if (proof.signature?.scheme !== "ed25519") {
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

  if (proof.signature.message !== proofMessage(proof)) {
    return { valid: false, reason: "Signed message does not match current proof payload." };
  }

  if (Number.isNaN(Date.parse(proof.issuedAt)) || Number.isNaN(Date.parse(proof.expiresAt))) {
    return { valid: false, reason: "Proof timestamps are invalid." };
  }

  try {
    new PublicKey(proof.tenantWallet);
    if (proof.issuerPublicKey) bs58.decode(proof.issuerPublicKey);
    bs58.decode(proof.signature.value);
  } catch {
    return { valid: false, reason: "Proof contains an invalid wallet or signature encoding." };
  }

  return { valid: true, reason: "Proof integrity fields are complete." };
};

export const verifyProofSignature = (proof: Proof) => {
  if (!proof.signature) return false;

  try {
    const publicKey = new PublicKey(proof.signature.signer);
    const signature = bs58.decode(proof.signature.value);
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
  const proofHashValid =
    Boolean(proof.attestation) &&
    proof.attestation?.proofHash === currentProofHash &&
    proof.proofHash === currentProofHash;
  const attestationSignatureValid = verifyAttestationSignature(proof);
  const attestationHashValid = proof.attestation ? proof.attestation.attestationHash === attestationHash(proof.attestation) : false;
  const trustedIssuer = verifyTrustedIssuer(proof);
  const revoked = proof.validity === "revoked" || Boolean(proof.revokedAt);

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
  };
};
