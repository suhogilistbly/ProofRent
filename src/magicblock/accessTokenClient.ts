import bs58 from "bs58";
import { getMagicBlockConfigStatus, magicBlockConfig, MAGICBLOCK_SIMULATION_MESSAGE } from "./magicblockConfig";
import type {
  MagicBlockAccessTokenResponse,
  MagicBlockAccessTokenState,
  MagicBlockWalletChallenge,
} from "./types";

const STORAGE_KEY = "proofrent.magicblock.accessToken";
const encoder = new TextEncoder();

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

const randomHex = (length: number) => {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

export const createMagicBlockWalletChallenge = (wallet: string): MagicBlockWalletChallenge => {
  const issuedAt = new Date().toISOString();

  return {
    wallet,
    issuedAt,
    challenge: [
      "ProofRent MagicBlock PER access request",
      `wallet=${wallet}`,
      `programId=${magicBlockConfig.programId}`,
      `nonce=${randomHex(32)}`,
      `issuedAt=${issuedAt}`,
    ].join("\n"),
  };
};

export const verifyAccessTokenShape = (value: unknown): MagicBlockAccessTokenResponse => {
  if (!isRecord(value) || typeof value.accessToken !== "string" || value.accessToken.length === 0) {
    throw new Error("MagicBlock access token response is missing accessToken.");
  }

  return {
    accessToken: value.accessToken,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
    tokenType: value.tokenType === "Bearer" ? "Bearer" : undefined,
  };
};

export const storeAccessToken = (state: MagicBlockAccessTokenState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const getStoredAccessToken = (): MagicBlockAccessTokenState => {
  const configStatus = getMagicBlockConfigStatus();
  if (!configStatus.configured) {
    return {
      authenticated: false,
      message: MAGICBLOCK_SIMULATION_MESSAGE,
    };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {
        authenticated: false,
        message: "MagicBlock access token has not been issued in this browser session.",
      };
    }

    const state = JSON.parse(stored) as MagicBlockAccessTokenState;
    if (state.expiresAt && Date.parse(state.expiresAt) <= Date.now()) {
      return {
        authenticated: false,
        message: "MagicBlock access token has expired.",
      };
    }

    return state;
  } catch {
    return {
      authenticated: false,
      message: "Stored MagicBlock access token state is unreadable.",
    };
  }
};

export const requestMagicBlockAccessToken = async (
  wallet: string,
  signMessage: SignMessage,
): Promise<MagicBlockAccessTokenState> => {
  const configStatus = getMagicBlockConfigStatus();
  if (!configStatus.configured) {
    const state = {
      authenticated: false,
      message: MAGICBLOCK_SIMULATION_MESSAGE,
    };
    storeAccessToken(state);
    return state;
  }

  const walletChallenge = createMagicBlockWalletChallenge(wallet);
  const signatureBytes = await signMessage(encoder.encode(walletChallenge.challenge));
  const signature = bs58.encode(signatureBytes);

  const response = await fetch(magicBlockConfig.accessTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet,
      challenge: walletChallenge.challenge,
      signature,
      issuedAt: walletChallenge.issuedAt,
      programId: magicBlockConfig.programId,
    }),
  });

  if (!response.ok) {
    throw new Error(`MagicBlock access token request failed with ${response.status}.`);
  }

  const token = verifyAccessTokenShape(await response.json());
  const state: MagicBlockAccessTokenState = {
    authenticated: true,
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
    wallet,
    message: "MagicBlock access token issued.",
  };
  storeAccessToken(state);
  return state;
};
