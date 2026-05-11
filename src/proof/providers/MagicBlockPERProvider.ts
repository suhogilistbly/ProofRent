import { issueProof } from "../../proofApi";
import { magicBlockConfig } from "../../magicblock/magicblockConfig";
import { createMagicBlockConnections } from "../../magicblock/magicblockClient";
import type { ProofExecutionProvider, PrivateVerificationInput, PrivateVerificationResult } from "./ProofExecutionProvider";

export class MagicBlockPERProvider implements ProofExecutionProvider {
  readonly provider = "magicblock-per" as const;

  canExecute(input: PrivateVerificationInput) {
    return Boolean(
      input.encryptedPayload.mode === "magicblock-encrypted" &&
        input.accessToken &&
        input.attestationSession?.verified &&
        magicBlockConfig.perRpcUrl,
    );
  }

  async executePrivateVerification(input: PrivateVerificationInput): Promise<PrivateVerificationResult> {
    if (!this.canExecute(input)) {
      throw new Error("MagicBlock PER provider requires verified attestation and an access token.");
    }

    const issuedAt = new Date().toISOString();
    const connections = createMagicBlockConnections(input.accessToken);
    const { proof } = await issueProof({
      propertyId: input.propertyId,
      rent: input.rent,
      tenantWallet: input.tenantWallet,
      timestamp: input.timestamp,
      nonce: input.nonce,
      requestMessage: input.requestMessage,
      protectedPayload: input.encryptedPayload,
      requestSignature: input.requestSignature,
      magicBlockAccess: {
        accessToken: input.accessToken,
      },
    });

    const executionMetadata = proof.executionMetadata ?? {
      provider: this.provider,
      perRpcUrl: connections.perRpcUrl,
      attestationVerified: false,
      accessTokenUsed: Boolean(input.accessToken),
      executionEnvironment: "MagicBlock PER execution metadata unavailable",
      issuedAt,
    };

    const attestation = proof.attestation;

    return {
      proof: {
        ...proof,
        executionProvider: proof.executionProvider,
        executionMetadata,
        attestation,
      },
      attestation,
      executionMetadata,
    };
  }
}
