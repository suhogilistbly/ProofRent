import type { MagicBlockConfig, MagicBlockConfigStatus } from "./types";

export const MAGICBLOCK_SIMULATION_MESSAGE =
  "MagicBlock PER is not configured. Running in local simulation mode.";

const trim = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const magicBlockConfig: MagicBlockConfig = {
  solanaRpcUrl: trim(import.meta.env.VITE_SOLANA_RPC_URL),
  perRpcUrl: trim(import.meta.env.VITE_MAGICBLOCK_PER_RPC_URL),
  attestationUrl: trim(import.meta.env.VITE_MAGICBLOCK_ATTESTATION_URL),
  accessTokenUrl: trim(import.meta.env.VITE_MAGICBLOCK_ACCESS_TOKEN_URL),
  programId: trim(import.meta.env.VITE_PROOFRENT_PROGRAM_ID),
  trustedIssuer: trim(import.meta.env.VITE_PROOFRENT_TRUSTED_ISSUER),
};

export const getMagicBlockConfigStatus = (
  config: MagicBlockConfig = magicBlockConfig,
): MagicBlockConfigStatus => {
  const required: Array<keyof MagicBlockConfig> = [
    "solanaRpcUrl",
    "perRpcUrl",
    "attestationUrl",
    "accessTokenUrl",
    "programId",
    "trustedIssuer",
  ];
  const missing = required.filter((key) => !config[key]);

  return {
    configured: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? "MagicBlock PER configuration is present."
        : MAGICBLOCK_SIMULATION_MESSAGE,
  };
};
