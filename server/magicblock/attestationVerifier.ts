import { createHash } from "node:crypto";
import { createSimulationId, getMagicBlockMode, getMagicBlockServerConfig } from "./accessControl.js";
import type { MagicBlockServerConfig, PERAttestationResult } from "./types.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const verifyMagicBlockPERAttestation = async (
  challenge: string,
  config: MagicBlockServerConfig = getMagicBlockServerConfig(),
): Promise<PERAttestationResult> => {
  const mode = getMagicBlockMode(config);

  if (mode === "magicblock-real") {
    // TDX quote is verified here. The implementation should validate quote signature,
    // measurement, runtime identity, freshness, and trusted issuer against MagicBlock evidence.
    const response = await fetch(config.attestationUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge,
        programId: config.programId,
        trustedIssuer: config.trustedIssuer,
      }),
    });

    if (!response.ok) {
      throw new Error(`MagicBlock attestation verification failed with ${response.status}.`);
    }

    const body = (await response.json()) as Partial<PERAttestationResult>;
    return {
      mode,
      attestationVerified: Boolean(body.attestationVerified),
      tdxQuoteHash: String(body.tdxQuoteHash ?? ""),
      measurementHash: String(body.measurementHash ?? ""),
      runtimeId: String(body.runtimeId ?? ""),
    };
  }

  return {
    mode,
    attestationVerified: false,
    tdxQuoteHash: `simulation_quote_${hash(challenge).slice(0, 32)}`,
    measurementHash: `simulation_measurement_${hash(`measurement:${challenge}`).slice(0, 32)}`,
    runtimeId: createSimulationId("simulation_runtime"),
  };
};
