import express from "express";
import cors from "cors";
import { MagicBlockPERAdapter } from "./magicblock/MagicBlockPERAdapter.js";
import { getMagicBlockMode, getMagicBlockServerConfig } from "./magicblock/accessControl.js";
import {
  getAuditLog,
  getStoredProof,
  getServicePublicKey,
  issueProofWithSettlement,
  recordVerificationAudit,
  revokeProofWithSettlement,
  validateIssueRequest,
  verifyProof,
} from "./proofService.js";
import type { Proof } from "../src/types.js";

const app = express();
const port = Number(process.env.PROOFRENT_CONFIDENTIAL_PORT ?? 8787);
const hostFromUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
};

app.use(cors({ origin: true }));
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "ProofRent simulated confidential execution service",
    signer: getServicePublicKey(),
  });
});

app.get("/api/magicblock/status", (_request, response) => {
  const config = getMagicBlockServerConfig();
  const perRpcConfigured = Boolean(config.perRpcUrl);
  const attestationConfigured = Boolean(config.attestationUrl);
  const accessTokenConfigured = Boolean(config.accessTokenUrl);
  const trustedIssuerConfigured = Boolean(config.trustedIssuer);
  const executionMode = getMagicBlockMode(config);

  response.json({
    configured: executionMode === "magicblock-real",
    executionMode: executionMode === "magicblock-real" ? "magicblock-real" : "not configured",
    checks: {
      perRpcConfigured,
      attestationConfigured,
      accessTokenConfigured,
      trustedIssuerConfigured,
    },
    metadata: {
      perRpcHost: hostFromUrl(config.perRpcUrl),
      attestationHost: hostFromUrl(config.attestationUrl),
      accessTokenHost: hostFromUrl(config.accessTokenUrl),
      solanaRpcConfigured: Boolean(config.solanaRpcUrl),
      programIdConfigured: Boolean(config.programId),
    },
    missing: [
      !perRpcConfigured ? "MAGICBLOCK_PER_RPC_URL" : undefined,
      !attestationConfigured ? "MAGICBLOCK_ATTESTATION_URL" : undefined,
      !accessTokenConfigured ? "MAGICBLOCK_ACCESS_TOKEN_URL" : undefined,
      !trustedIssuerConfigured ? "SERVER_PROOF_ISSUER_PUBLIC_KEY" : undefined,
    ].filter(Boolean),
  });
});

app.post("/api/magicblock/test/per-adapter", async (request, response) => {
  try {
    const config = getMagicBlockServerConfig();
    if (getMagicBlockMode(config) !== "magicblock-real") {
      response.status(400).json({
        ok: false,
        error: "MagicBlock PER adapter test requires MAGICBLOCK_PER_RPC_URL, MAGICBLOCK_ATTESTATION_URL, and MAGICBLOCK_ACCESS_TOKEN_URL.",
        reason: "MagicBlock PER adapter test requires MAGICBLOCK_PER_RPC_URL, MAGICBLOCK_ATTESTATION_URL, and MAGICBLOCK_ACCESS_TOKEN_URL.",
        executionMode: "not configured",
      });
      return;
    }

    const result = await new MagicBlockPERAdapter(config).executePrivateProofJob({
      propertyId: request.body?.propertyId ?? "diagnostic-property",
      rent: Number(request.body?.rent ?? 800),
      tenantWallet: request.body?.tenantWallet ?? "diagnostic-wallet",
      encryptedPayload: request.body?.encryptedPayload ?? "diagnostic-encrypted-payload",
      payloadCommitment: request.body?.payloadCommitment ?? "diagnostic-payload-commitment",
      accessToken: request.body?.accessToken,
      permissionGroup: request.body?.permissionGroup,
    });

    response.json({
      ok: true,
      executionMode: result.executionMode,
      metadata: {
        provider: result.executionReceipt.provider,
        runtimeId: result.runtimeId,
        measurementHash: result.measurementHash,
        attestationVerified: result.attestationEvidence.attestationVerified,
        jobId: result.executionReceipt.jobId,
        issuedAt: result.executionReceipt.issuedAt,
      },
    });
  } catch (error) {
    response.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "MagicBlock PER adapter diagnostic failed.",
      reason: error instanceof Error ? error.message : "MagicBlock PER adapter diagnostic failed.",
    });
  }
});

app.post("/api/proofs/issue", async (request, response) => {
  try {
    const proofRequest = validateIssueRequest(request.body);
    const result = await issueProofWithSettlement(proofRequest);
    response.status(201).json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Proof request failed.",
    });
  }
});

app.post("/api/proofs/verify", (request, response) => {
  const proof = request.body?.proof as Proof | undefined;
  if (!proof) {
    response.status(400).json({ error: "proof is required." });
    return;
  }

  const verification = verifyProof(proof);
  recordVerificationAudit(proof, verification);
  response.json({ verification });
});

app.post("/api/proofs/revoke", async (request, response) => {
  const proofId = request.body?.proofId;
  if (!proofId || typeof proofId !== "string") {
    response.status(400).json({ error: "proofId is required." });
    return;
  }

  await revokeProofWithSettlement(proofId, request.body?.reason ?? "Revoked by ProofRent verifier.");
  response.status(202).json({ revoked: true, proofId });
});

app.get("/api/proofs/:proofId/status", (request, response) => {
  const proof = getStoredProof(request.params.proofId);
  if (!proof) {
    response.status(404).json({ error: "proof not found." });
    return;
  }

  const verification = verifyProof(proof);
  recordVerificationAudit(proof, verification);
  response.json({
    proofId: request.params.proofId,
    status: proof.validity,
    verification,
  });
});

app.get("/api/proofs/:proofId/public", (request, response) => {
  const proof = getStoredProof(request.params.proofId);
  if (!proof) {
    response.status(404).json({ error: "proof not found." });
    return;
  }

  const verification = verifyProof(proof);
  recordVerificationAudit(proof, verification);
  response.json({
    proof,
    verification,
  });
});

app.post("/api/proofs/:proofId/verify", (request, response) => {
  const proof = request.body?.proof as Proof | undefined;
  if (!proof) {
    response.status(400).json({ error: "proof is required for stateless share URL verification." });
    return;
  }
  if ((proof.proofId || proof.id) !== request.params.proofId) {
    response.status(400).json({ error: "proofId does not match the submitted proof." });
    return;
  }

  const verification = verifyProof(proof);
  recordVerificationAudit(proof, verification);
  response.json({
    proofId: request.params.proofId,
    verification,
    badges: {
      signed: verification.signatureValid,
      verified: verification.valid,
      untampered: verification.integrityValid,
      active: !verification.expired && !verification.revoked,
      attested: verification.attestationSignatureValid && verification.proofHashValid,
    },
  });
});

app.post("/api/proofs/:proofId/attestation/verify", (request, response) => {
  const proof = request.body?.proof as Proof | undefined;
  if (!proof) {
    response.status(400).json({ error: "proof is required." });
    return;
  }

  response.json({
    proofId: request.params.proofId,
    attested:
      (proof.proofId || proof.id) === request.params.proofId &&
      proof.attestationStatus === "attested" &&
      proof.attestation?.verificationStatus === "verified" &&
      Boolean(proof.attestation?.attestationId) &&
      Boolean(proof.attestation?.proofHash),
    attestationId: proof.attestation?.attestationId ?? "Unavailable",
    issuer: proof.attestation?.issuer ?? "Unavailable",
    executionEnvironment: proof.attestation?.executionEnvironment ?? "Unavailable",
    provider: proof.attestation?.provider ?? "Unavailable",
    measurement: proof.attestation?.measurement ?? "Unavailable",
  });
});

app.post("/api/proofs/:proofId/revoke", async (request, response) => {
  await revokeProofWithSettlement(request.params.proofId, request.body?.reason ?? "Revoked by ProofRent verifier.");
  response.status(202).json({ revoked: true, proofId: request.params.proofId });
});

app.get("/api/audit", (_request, response) => {
  response.json({
    // Sanitized audit events only. Raw financial payloads are intentionally absent.
    events: getAuditLog(),
  });
});

app.listen(port, () => {
  console.log(`ProofRent simulated confidential execution service listening on http://localhost:${port}`);
});
