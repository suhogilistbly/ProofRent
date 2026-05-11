import { createHash, randomBytes } from "node:crypto";
import type { MagicBlockAdapterMode, MagicBlockServerConfig, TenantAuthenticationResult } from "./types.js";

const addMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const getMagicBlockServerConfig = (): MagicBlockServerConfig => ({
  perRpcUrl: process.env.MAGICBLOCK_PER_RPC_URL,
  attestationUrl: process.env.MAGICBLOCK_ATTESTATION_URL,
  accessTokenUrl: process.env.MAGICBLOCK_ACCESS_TOKEN_URL,
  solanaRpcUrl: process.env.SOLANA_RPC_URL,
  programId: process.env.PROOFRENT_PROGRAM_ID,
  trustedIssuer: process.env.SERVER_PROOF_ISSUER_PUBLIC_KEY,
});

export const getMagicBlockMode = (config: MagicBlockServerConfig = getMagicBlockServerConfig()): MagicBlockAdapterMode =>
  config.perRpcUrl && config.attestationUrl && config.accessTokenUrl ? "magicblock-real" : "simulation";

export const authenticateTenantAccess = async (
  wallet: string,
  signedChallenge: string,
  config: MagicBlockServerConfig = getMagicBlockServerConfig(),
): Promise<TenantAuthenticationResult> => {
  const mode = getMagicBlockMode(config);

  if (mode === "magicblock-real") {
    // MagicBlock account permissions are checked here by exchanging the wallet signed challenge
    // with the MagicBlock access-control endpoint and receiving a scoped PER access token.
    const response = await fetch(config.accessTokenUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet,
        signedChallenge,
        programId: config.programId,
      }),
    });

    if (!response.ok) {
      throw new Error(`MagicBlock access-control request failed with ${response.status}.`);
    }

    const body = (await response.json()) as Partial<TenantAuthenticationResult>;
    return {
      mode,
      accessToken: String(body.accessToken ?? ""),
      permissionGroup: String(body.permissionGroup ?? `proofrent:${wallet}`),
      expiresAt: String(body.expiresAt ?? addMinutes(10)),
    };
  }

  return {
    mode,
    accessToken: `simulation_token_${hash(`${wallet}:${signedChallenge}`).slice(0, 32)}`,
    permissionGroup: `simulation_permission_${hash(wallet).slice(0, 16)}`,
    expiresAt: addMinutes(10),
  };
};

export const createSimulationId = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`;
