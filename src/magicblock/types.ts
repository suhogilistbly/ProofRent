import type { Connection } from "@solana/web3.js";

export type MagicBlockConfig = {
  solanaRpcUrl: string;
  perRpcUrl: string;
  attestationUrl: string;
  accessTokenUrl: string;
  programId: string;
  trustedIssuer: string;
};

export type MagicBlockConfigStatus = {
  configured: boolean;
  missing: Array<keyof MagicBlockConfig>;
  message: string;
};

export type MagicBlockConnectionBundle = {
  solanaConnection: Connection;
  perConnection: Connection;
  perRpcUrl: string;
};

export type MagicBlockAttestationChallenge = {
  challenge: string;
  issuedAt: string;
};

export type MagicBlockAttestationResponse = {
  issuer: string;
  challenge: string;
  status: "verified" | "failed";
  evidence: string;
  measurement?: string;
  expiresAt?: string;
};

export type MagicBlockAttestationStatus = {
  configured: boolean;
  verified: boolean;
  message: string;
  issuer?: string;
  measurement?: string;
  evidence?: string;
  checkedAt?: string;
};

export type MagicBlockWalletChallenge = {
  challenge: string;
  wallet: string;
  issuedAt: string;
};

export type MagicBlockAccessTokenResponse = {
  accessToken: string;
  expiresAt?: string;
  tokenType?: "Bearer";
};

export type MagicBlockAccessTokenState = {
  authenticated: boolean;
  accessToken?: string;
  expiresAt?: string;
  wallet?: string;
  message: string;
};

export type MagicBlockRuntimeStatus = {
  configured: boolean;
  connected: boolean;
  mode: "magicblock" | "simulation";
  message: string;
  attestation: MagicBlockAttestationStatus;
  accessToken: MagicBlockAccessTokenState;
};
