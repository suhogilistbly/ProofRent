import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  clearProofSecurityStateForTests,
  createRequestMessage,
  issueProof,
  issueProofWithSettlement,
  validateIssueRequest,
  verifyProof,
  type ProofIssueRequest,
} from "./proofService.js";

const encoder = new TextEncoder();

const createPayload = () => ({
  mode: "local-plaintext-demo" as const,
  payloadCommitment: "commit_test_payload",
  encryptionContext: "local-plaintext-demo" as const,
  plaintextProfile: {
    monthlyIncome: 5000,
    monthlyExpenses: 1200,
    savings: 8000,
    monthlyDebt: 300,
  },
});

const createEncryptedPayload = () => ({
  mode: "magicblock-encrypted" as const,
  payloadCommitment: "commit_test_payload",
  encryptionContext: "magicblock-rsa-oaep-sha256" as const,
  encryptedPayload: "encrypted_payload_bytes",
  encryptionPublicKey: "execution_public_key",
});

const createSignedRequest = ({
  timestamp = new Date().toISOString(),
  nonce = `nonce_${randomUUID().replaceAll("-", "")}`,
  signer = Keypair.generate(),
  signatureKeypair = signer,
  protectedPayload = createPayload(),
}: {
  timestamp?: string;
  nonce?: string;
  signer?: Keypair;
  signatureKeypair?: Keypair;
  protectedPayload?: ProofIssueRequest["protectedPayload"];
} = {}): ProofIssueRequest => {
  const unsigned = {
    propertyId: "modern-studio-apartment",
    rent: 800,
    tenantWallet: signer.publicKey.toBase58(),
    timestamp,
    nonce,
    requestMessage: "",
    protectedPayload,
    requestSignature: {
      scheme: "ed25519" as const,
      signer: signer.publicKey.toBase58(),
      value: "",
      message: "",
    },
  };
  const requestMessage = createRequestMessage(unsigned);
  const signature = nacl.sign.detached(encoder.encode(requestMessage), signatureKeypair.secretKey);

  return {
    ...unsigned,
    requestMessage,
    requestSignature: {
      ...unsigned.requestSignature,
      value: bs58.encode(signature),
      message: requestMessage,
    },
  };
};

test.beforeEach(() => {
  clearProofSecurityStateForTests();
});

test("unsigned request rejected", () => {
  const request = createSignedRequest();
  assert.throws(
    () => validateIssueRequest({ ...request, requestSignature: undefined }),
    /requestSignature is required/,
  );
});

test("invalid signature rejected", () => {
  const request = createSignedRequest({ signatureKeypair: Keypair.generate() });
  assert.throws(
    () => validateIssueRequest(request),
    /Tenant request signature is invalid/,
  );
});

test("reused nonce rejected", async () => {
  const request = createSignedRequest({ nonce: "nonce_reused_1234567890" });
  const validated = validateIssueRequest(request);
  await issueProof(validated);

  assert.throws(
    () => validateIssueRequest(request),
    /Replay protection rejected this proof request nonce/,
  );
});

test("expired timestamp rejected", () => {
  const request = createSignedRequest({
    timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  });

  assert.throws(
    () => validateIssueRequest(request),
    /request timestamp is expired/,
  );
});

test("valid signed request accepted", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const result = await issueProof(request);

  assert.equal(result.proof.tenantWallet, request.tenantWallet);
  assert.equal(result.proof.propertyId, request.propertyId);
  assert.equal(result.verification.valid, true);
});

test("proof settlement reports not configured without Solana registry env", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const result = await issueProofWithSettlement(request);

  assert.equal(result.proof.onChainCommitment?.configured, false);
  assert.equal(result.proof.onChainCommitment?.status, "not_configured");
  assert.equal(result.proof.solanaTxSignature, undefined);
  assert.equal(result.proof.commitmentStatus, "not_configured");
  assert.equal(result.verification.onChainCommitmentStatus, "not_configured");
});

test("encrypted mode does not send raw profile", () => {
  const encryptedRequest = createSignedRequest({ protectedPayload: createEncryptedPayload() });

  assert.equal("plaintextProfile" in encryptedRequest.protectedPayload, false);
});

test("encrypted mode fails clearly without MagicBlock configuration", async () => {
  const request = validateIssueRequest(createSignedRequest({ protectedPayload: createEncryptedPayload() }));

  await assert.rejects(
    () => issueProof(request),
    /MagicBlock encrypted mode requires MAGICBLOCK_PER_RPC_URL/,
  );
});

test("simulation mode clearly labels plaintext payload", () => {
  const request = createSignedRequest();

  assert.equal(request.protectedPayload.mode, "local-plaintext-demo");
  assert.equal(request.protectedPayload.encryptionContext, "local-plaintext-demo");
  assert.equal(Boolean(request.protectedPayload.plaintextProfile), true);
});

test("valid trusted proof passes", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);
  const verification = verifyProof(proof);

  assert.ok(proof.canonicalPayload);
  assert.ok(proof.issuerSignature);
  assert.deepEqual(Object.keys(proof.canonicalPayload!).sort(), [
    "checks",
    "createdAt",
    "executionMode",
    "issuer",
    "proofId",
    "propertyId",
    "riskLevel",
    "score",
    "status",
    "validUntil",
  ]);
  assert.equal(verification.valid, true);
  assert.equal(verification.trustedIssuerValid, true);
});

test("valid signature from wrong issuer fails", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);
  const wrongIssuer = Keypair.generate();
  const signature = nacl.sign.detached(encoder.encode(proof.issuerSignature!.message), wrongIssuer.secretKey);

  proof.issuerSignature = {
    ...proof.issuerSignature!,
    signer: wrongIssuer.publicKey.toBase58(),
    value: bs58.encode(signature),
  };
  proof.signature = proof.issuerSignature;

  const verification = verifyProof(proof);
  assert.equal(verification.valid, false);
  assert.match(verification.reason, /trusted issuer|unknown issuer|not produced by the trusted issuer/i);
});

test("tampered issuer fails", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);

  proof.issuerPublicKey = Keypair.generate().publicKey.toBase58();

  const verification = verifyProof(proof);
  assert.equal(verification.valid, false);
  assert.equal(verification.verificationStatus, "tampered");
});

test("tampered proof body fails", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);

  proof.canonicalPayload!.riskLevel = "high";

  const verification = verifyProof(proof);
  assert.equal(verification.valid, false);
  assert.equal(verification.verificationStatus, "tampered");
});

test("serialize sign store reload verifies canonical payload", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);
  const reloaded = JSON.parse(JSON.stringify(proof));

  const verification = verifyProof(reloaded);

  assert.equal(verification.valid, true);
  assert.equal(verification.proofHashValid, true);
});

test("localStorage-style roundtrip ignores UI-only metadata changes", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);
  const reloaded = JSON.parse(JSON.stringify({
    ...proof,
    handoffPreview: "landlord-ui-only",
    onChainCommitment: {
      configured: false,
      status: "not_configured",
      proofHash: proof.proofHash,
      reason: "Solana settlement not configured",
    },
  }));

  const verification = verifyProof(reloaded);

  assert.equal(verification.valid, true);
  assert.equal(verification.proofHashValid, true);
});

test("serverless memory reset still verifies submitted proof payload", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);
  const submittedProof = JSON.parse(JSON.stringify(proof));
  clearProofSecurityStateForTests();

  const verification = verifyProof(submittedProof);

  assert.equal(verification.valid, true);
  assert.ok(verification.diagnostics.includes("proof missing"));
});

test("landlord verification after refresh remains valid", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProofWithSettlement(request);
  const refreshedProof = JSON.parse(JSON.stringify(proof));

  const verification = verifyProof(refreshedProof);

  assert.equal(verification.valid, true);
  assert.equal(verification.attestationSignatureValid, true);
});

test("public proof verification after redeploy uses embedded signed payload", async () => {
  const request = validateIssueRequest(createSignedRequest());
  const { proof } = await issueProof(request);
  const embeddedProofPayload = Buffer.from(encodeURIComponent(JSON.stringify(proof))).toString("base64url");
  clearProofSecurityStateForTests();
  const publicProof = JSON.parse(decodeURIComponent(Buffer.from(embeddedProofPayload, "base64url").toString("utf8")));

  const verification = verifyProof(publicProof);

  assert.equal(verification.valid, true);
  assert.equal(verification.signatureValid, true);
  assert.ok(verification.diagnostics.includes("proof missing"));
});
