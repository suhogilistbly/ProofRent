import type { PrivateFinancialProfile } from "../proofApi";

export type EncryptionMode = "magicblock-encrypted" | "local-plaintext-demo";

export type EncryptedFinancialPayload = {
  mode: "magicblock-encrypted";
  encryptionContext: "magicblock-rsa-oaep-sha256";
  encryptedPayload: string;
  encryptionPublicKey: string;
};

export type PlaintextDemoPayload = {
  mode: "local-plaintext-demo";
  encryptionContext: "local-plaintext-demo";
  plaintextProfile: PrivateFinancialProfile;
};

const encoder = new TextEncoder();

export const EXECUTION_PUBLIC_KEY = import.meta.env.VITE_MAGICBLOCK_EXECUTION_PUBLIC_KEY?.trim() ?? "";

export const PLAINTEXT_DEMO_MESSAGE =
  "Demo mode: financial inputs are sent to the local proof service. Production MagicBlock PER mode encrypts payloads to the execution environment.";

export const getEncryptionMode = (): EncryptionMode =>
  EXECUTION_PUBLIC_KEY ? "magicblock-encrypted" : "local-plaintext-demo";

const base64ToBytes = (base64: string) => {
  const binary = atob(base64.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

export const importExecutionPublicKey = async (publicKey: string) =>
  crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKey),
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"],
  );

export const encryptFinancialProfile = async (
  profile: PrivateFinancialProfile,
  executionPublicKey = EXECUTION_PUBLIC_KEY,
): Promise<EncryptedFinancialPayload> => {
  if (!executionPublicKey) {
    throw new Error("MagicBlock execution public key is not configured.");
  }

  const publicKey = await importExecutionPublicKey(executionPublicKey);
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    encoder.encode(JSON.stringify(profile)),
  );

  return {
    mode: "magicblock-encrypted",
    encryptionContext: "magicblock-rsa-oaep-sha256",
    encryptedPayload: bytesToBase64(new Uint8Array(encrypted)),
    encryptionPublicKey: executionPublicKey,
  };
};

export const createPlaintextDemoPayload = (profile: PrivateFinancialProfile): PlaintextDemoPayload => ({
  mode: "local-plaintext-demo",
  encryptionContext: "local-plaintext-demo",
  plaintextProfile: profile,
});
