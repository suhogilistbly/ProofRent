import { getMagicBlockConfigStatus, magicBlockConfig, MAGICBLOCK_SIMULATION_MESSAGE } from "./magicblockConfig";
import type {
  MagicBlockAttestationChallenge,
  MagicBlockAttestationResponse,
  MagicBlockAttestationStatus,
} from "./types";

const STORAGE_KEY = "proofrent.magicblock.attestation";

const randomHex = (length: number) => {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

export const createMagicBlockAttestationChallenge = (): MagicBlockAttestationChallenge => ({
  challenge: `proofrent-attestation-${randomHex(32)}`,
  issuedAt: new Date().toISOString(),
});

export const verifyMagicBlockAttestationShape = (
  value: unknown,
  challenge: string,
  trustedIssuer = magicBlockConfig.trustedIssuer,
): MagicBlockAttestationResponse => {
  if (!isRecord(value)) {
    throw new Error("MagicBlock attestation response is not an object.");
  }

  const response = value as Partial<MagicBlockAttestationResponse>;
  if (response.status !== "verified") {
    throw new Error("MagicBlock attestation did not report a verified status.");
  }
  if (response.challenge !== challenge) {
    throw new Error("MagicBlock attestation challenge does not match this client request.");
  }
  if (!response.issuer || typeof response.issuer !== "string") {
    throw new Error("MagicBlock attestation issuer is missing.");
  }
  if (trustedIssuer && response.issuer !== trustedIssuer) {
    throw new Error("MagicBlock attestation issuer is not trusted for ProofRent.");
  }
  if (!response.evidence || typeof response.evidence !== "string") {
    throw new Error("MagicBlock attestation evidence is missing.");
  }

  return response as MagicBlockAttestationResponse;
};

export const storeAttestationStatus = (status: MagicBlockAttestationStatus) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
};

export const getStoredAttestationStatus = (): MagicBlockAttestationStatus => {
  const configStatus = getMagicBlockConfigStatus();
  if (!configStatus.configured) {
    return {
      configured: false,
      verified: false,
      message: MAGICBLOCK_SIMULATION_MESSAGE,
    };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {
        configured: true,
        verified: false,
        message: "MagicBlock attestation has not been verified in this browser session.",
      };
    }
    return JSON.parse(stored) as MagicBlockAttestationStatus;
  } catch {
    return {
      configured: true,
      verified: false,
      message: "Stored MagicBlock attestation status is unreadable.",
    };
  }
};

export const requestMagicBlockAttestation = async (): Promise<MagicBlockAttestationStatus> => {
  const configStatus = getMagicBlockConfigStatus();
  if (!configStatus.configured) {
    const status = {
      configured: false,
      verified: false,
      message: MAGICBLOCK_SIMULATION_MESSAGE,
    };
    storeAttestationStatus(status);
    return status;
  }

  const challenge = createMagicBlockAttestationChallenge();
  const response = await fetch(magicBlockConfig.attestationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge: challenge.challenge,
      issuedAt: challenge.issuedAt,
      programId: magicBlockConfig.programId,
    }),
  });

  if (!response.ok) {
    throw new Error(`MagicBlock attestation request failed with ${response.status}.`);
  }

  const attestation = verifyMagicBlockAttestationShape(
    await response.json(),
    challenge.challenge,
    magicBlockConfig.trustedIssuer,
  );
  const status: MagicBlockAttestationStatus = {
    configured: true,
    verified: true,
    message: "MagicBlock attestation verified.",
    issuer: attestation.issuer,
    measurement: attestation.measurement,
    evidence: attestation.evidence,
    checkedAt: new Date().toISOString(),
  };
  storeAttestationStatus(status);
  return status;
};
