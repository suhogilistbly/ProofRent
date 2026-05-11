import type { Application, Proof } from "./types";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import type { PrivateFinancialProfile, ProofIssueRequest, ProtectedTenantPayload } from "./proofApi";
import {
  createProofRequestMessage,
  createProtectedTenantPayload,
  createRequestNonce,
  executePrivateVerificationProof,
  signProofRequest,
} from "./proof/proofExecution";

export type { PrivateFinancialProfile, ProtectedTenantPayload };
export { createProtectedTenantPayload, createRequestNonce };

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

const id = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

const demoTenantKeypair = Keypair.generate();

export const getDemoTenantWallet = () => demoTenantKeypair.publicKey.toBase58();

const createProofRequest = async (
  propertyId: string,
  rent: number,
  profile: PrivateFinancialProfile,
  tenantWallet: string,
): Promise<ProofIssueRequest> => {
  const timestamp = new Date().toISOString();
  const nonce = createRequestNonce();
  const requestMessage = createProofRequestMessage({
    tenantWallet,
    propertyId,
    timestamp,
    nonce,
  });

  return {
    propertyId,
    rent,
    tenantWallet,
    timestamp,
    nonce,
    requestMessage,
    protectedPayload: await createProtectedTenantPayload(propertyId, rent, profile),
    requestSignature: {
      scheme: "ed25519",
      signer: tenantWallet,
      value: "",
      message: requestMessage,
    },
  };
};

export const generateProofWithProviders = async (
  propertyId: string,
  rent: number,
  profile: PrivateFinancialProfile,
  tenantWallet: string,
  signMessage: SignMessage,
): Promise<Proof> =>
  executePrivateVerificationProof({
    propertyId,
    rent,
    profile,
    tenantWallet,
    signMessage,
  });

export const generateDemoSignedProofWithProviders = async (
  propertyId: string,
  rent: number,
  profile: PrivateFinancialProfile,
): Promise<Proof> => {
  const request = await createProofRequest(propertyId, rent, profile, getDemoTenantWallet());
  const signedRequest = await signProofRequest(request, async (message) =>
    nacl.sign.detached(message, demoTenantKeypair.secretKey),
  );

  return executePrivateVerificationProof({
    propertyId,
    rent,
    profile,
    tenantWallet: signedRequest.tenantWallet,
    signMessage: async (message) => nacl.sign.detached(message, demoTenantKeypair.secretKey),
  });
};

export const getProofRequestMessage = createProofRequestMessage;

export const createApplication = (propertyId: string, proofId: string): Application => ({
  id: id("app"),
  propertyId,
  proofId,
  status: "pending",
  submittedAt: new Date().toISOString(),
  contactUnlocked: false,
});
