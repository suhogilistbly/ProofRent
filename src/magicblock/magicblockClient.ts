import { Connection } from "@solana/web3.js";
import { getMagicBlockConfigStatus, magicBlockConfig } from "./magicblockConfig";
import { getStoredAttestationStatus } from "./attestationClient";
import { getStoredAccessToken } from "./accessTokenClient";
import type { MagicBlockConfig, MagicBlockConnectionBundle, MagicBlockRuntimeStatus } from "./types";

export const withMagicBlockAccessToken = (perRpcUrl: string, accessToken?: string) => {
  if (!accessToken) return perRpcUrl;

  const url = new URL(perRpcUrl);
  url.searchParams.set("token", accessToken);
  return url.toString();
};

export const createMagicBlockConnections = (
  accessToken?: string,
  config: MagicBlockConfig = magicBlockConfig,
): MagicBlockConnectionBundle => {
  const status = getMagicBlockConfigStatus(config);
  if (!status.configured) {
    throw new Error(status.message);
  }

  const perRpcUrl = withMagicBlockAccessToken(config.perRpcUrl, accessToken);

  return {
    solanaConnection: new Connection(config.solanaRpcUrl, "confirmed"),
    perConnection: new Connection(perRpcUrl, "confirmed"),
    perRpcUrl,
  };
};

export const getMagicBlockRuntimeStatus = (): MagicBlockRuntimeStatus => {
  const configStatus = getMagicBlockConfigStatus();
  const attestation = getStoredAttestationStatus();
  const accessToken = getStoredAccessToken();
  const connected =
    configStatus.configured &&
    attestation.verified &&
    accessToken.authenticated &&
    Boolean(accessToken.accessToken);

  return {
    configured: configStatus.configured,
    connected,
    mode: connected ? "magicblock" : "simulation",
    message: connected
      ? "MagicBlock connected."
      : configStatus.message,
    attestation,
    accessToken,
  };
};
