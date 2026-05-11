import { issueProof } from "../../proofApi";
import type { ProofExecutionProvider, PrivateVerificationInput, PrivateVerificationResult } from "./ProofExecutionProvider";

export class LocalSimulationProvider implements ProofExecutionProvider {
  readonly provider = "local-simulation" as const;

  canExecute(input: PrivateVerificationInput) {
    return input.encryptedPayload.mode === "local-plaintext-demo";
  }

  async executePrivateVerification(input: PrivateVerificationInput): Promise<PrivateVerificationResult> {
    if (input.encryptedPayload.mode !== "local-plaintext-demo") {
      throw new Error("Local simulation provider only accepts explicitly labeled plaintext demo payloads.");
    }

    const issuedAt = new Date().toISOString();
    const executionMetadata = {
      provider: this.provider,
      perRpcUrl: undefined,
      attestationVerified: false,
      accessTokenUsed: false,
      executionEnvironment: "Local simulated confidential execution",
      issuedAt,
    };
    const proof = await issueProof({
      propertyId: input.propertyId,
      rent: input.rent,
      tenantWallet: input.tenantWallet,
      timestamp: input.timestamp,
      nonce: input.nonce,
      requestMessage: input.requestMessage,
      protectedPayload: input.encryptedPayload,
      requestSignature: input.requestSignature,
    }).then((response) => response.proof);

    return {
      proof: {
        ...proof,
        executionProvider: "Simulated local confidential execution",
        executionMetadata,
      },
      attestation: proof.attestation,
      executionMetadata,
    };
  }
}
