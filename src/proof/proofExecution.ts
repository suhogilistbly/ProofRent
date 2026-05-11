import bs58 from "bs58";
import type { PrivateFinancialProfile, ProofIssueRequest, ProtectedTenantPayload } from "../proofApi";
import { MAGICBLOCK_SIMULATION_MESSAGE, getMagicBlockConfigStatus } from "../magicblock/magicblockConfig";
import { requestMagicBlockAccessToken } from "../magicblock/accessTokenClient";
import { requestMagicBlockAttestation } from "../magicblock/attestationClient";
import type { Proof } from "../types";
import { LocalSimulationProvider } from "./providers/LocalSimulationProvider";
import { MagicBlockPERProvider } from "./providers/MagicBlockPERProvider";
import type { PrivateVerificationResult, ProofExecutionProvider } from "./providers/ProofExecutionProvider";
import {
  createPlaintextDemoPayload,
  encryptFinancialProfile,
  getEncryptionMode,
} from "../crypto/encryption";

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

export type ProofGenerationInput = {
  propertyId: string;
  rent: number;
  profile: PrivateFinancialProfile;
  tenantWallet: string;
  signMessage: SignMessage;
};

const encoder = new TextEncoder();

const randomHex = (length: number) => {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
};

const ordered = <T extends Record<string, unknown>>(value: T): T =>
  Object.keys(value)
    .sort()
    .reduce((result, key) => ({ ...result, [key]: value[key] }), {} as T);

export const createRequestNonce = () => `nonce_${randomHex(32)}`;

const createPayloadCommitment = async (propertyId: string, rent: number, profile: PrivateFinancialProfile) => {
  const material = JSON.stringify(ordered({ propertyId, rent, ...profile }));
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return `commit_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

export const createProtectedTenantPayload = async (
  propertyId: string,
  rent: number,
  profile: PrivateFinancialProfile,
): Promise<ProtectedTenantPayload> => {
  const payloadCommitment = await createPayloadCommitment(propertyId, rent, profile);

  if (getEncryptionMode() === "magicblock-encrypted") {
    return {
      ...(await encryptFinancialProfile(profile)),
      payloadCommitment,
    };
  }

  return {
    ...createPlaintextDemoPayload(profile),
    payloadCommitment,
  };
};

export const createProofRequestMessage = ({
  tenantWallet,
  propertyId,
  timestamp,
  nonce,
}: Pick<ProofIssueRequest, "tenantWallet" | "propertyId" | "timestamp" | "nonce">) =>
  [
    "ProofRent verification request",
    `tenantWallet: ${tenantWallet}`,
    `propertyId: ${propertyId}`,
    `timestamp: ${timestamp}`,
    `nonce: ${nonce}`,
  ].join("\n");

export const signProofRequest = async (
  request: ProofIssueRequest,
  signMessage: SignMessage,
): Promise<ProofIssueRequest> => {
  const message = createProofRequestMessage(request);
  const signatureBytes = await signMessage(encoder.encode(message));

  return {
    ...request,
    requestSignature: {
      scheme: "ed25519",
      signer: request.tenantWallet,
      value: bs58.encode(signatureBytes),
      message,
    },
  };
};

const selectProvider = (providers: ProofExecutionProvider[], input: Parameters<ProofExecutionProvider["canExecute"]>[0]) =>
  providers.find((provider) => provider.provider === "magicblock-per" && provider.canExecute(input)) ??
  providers.find((provider) => provider.provider === "local-simulation" && provider.canExecute(input));

export const executePrivateVerification = async ({
  propertyId,
  rent,
  profile,
  tenantWallet,
  signMessage,
}: ProofGenerationInput): Promise<PrivateVerificationResult> => {
  const encryptedPayload = await createProtectedTenantPayload(propertyId, rent, profile);
  const timestamp = new Date().toISOString();
  const nonce = createRequestNonce();
  const requestMessage = createProofRequestMessage({
    tenantWallet,
    propertyId,
    timestamp,
    nonce,
  });
  const unsignedRequest: ProofIssueRequest = {
    propertyId,
    rent,
    tenantWallet,
    timestamp,
    nonce,
    requestMessage,
    protectedPayload: encryptedPayload,
    requestSignature: {
      scheme: "ed25519",
      signer: tenantWallet,
      value: "",
      message: requestMessage,
    },
  };
  const signedRequest = await signProofRequest(unsignedRequest, signMessage);
  const configStatus = getMagicBlockConfigStatus();
  let accessToken: string | undefined;
  let attestationSession;

  if (configStatus.configured) {
    try {
      attestationSession = await requestMagicBlockAttestation();
      if (attestationSession.verified) {
        const tokenState = await requestMagicBlockAccessToken(tenantWallet, signMessage);
        accessToken = tokenState.accessToken;
      }
    } catch {
      attestationSession = {
        configured: true,
        verified: false,
        message: MAGICBLOCK_SIMULATION_MESSAGE,
      };
    }
  }

  const providerInput = {
    propertyId,
    rent,
    tenantWallet,
    timestamp: signedRequest.timestamp,
    nonce: signedRequest.nonce,
    requestMessage: signedRequest.requestMessage,
    encryptedPayload,
    requestSignature: signedRequest.requestSignature,
    accessToken,
    attestationSession,
  };
  const provider = selectProvider(
    [new MagicBlockPERProvider(), new LocalSimulationProvider()],
    providerInput,
  );

  if (!provider) {
    throw new Error("No proof execution provider is available.");
  }

  return provider.executePrivateVerification(providerInput);
};

export const executePrivateVerificationProof = async (input: ProofGenerationInput): Promise<Proof> => {
  const result = await executePrivateVerification(input);
  return result.proof;
};
