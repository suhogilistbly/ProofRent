import { randomBytes, createHash } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Proof } from "../src/types.js";
import { getMagicBlockMode, getMagicBlockServerConfig } from "./magicblock/accessControl.js";

type PrivateFinancialProfile = {
  monthlyIncome: number;
  monthlyExpenses: number;
  savings: number;
  monthlyDebt: number;
};

type ProtectedTenantPayload = {
  mode: "local-plaintext-demo" | "magicblock-encrypted";
  payloadCommitment: string;
  encryptionContext: "local-plaintext-demo" | "magicblock-rsa-oaep-sha256";
  plaintextProfile?: PrivateFinancialProfile;
  encryptedPayload?: string;
  encryptionPublicKey?: string;
};

export type ProofIssueRequest = {
  propertyId: string;
  rent: number;
  tenantWallet: string;
  timestamp: string;
  nonce: string;
  requestMessage: string;
  protectedPayload: ProtectedTenantPayload;
  requestSignature: {
    scheme: "ed25519";
    signer: string;
    value: string;
    message?: string;
  };
  magicBlockAccess?: {
    accessToken?: string;
    permissionGroup?: string;
  };
};

export type ProofVerificationResult = {
  valid: boolean;
  reason: string;
  expired: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  proofHashValid: boolean;
  attestationSignatureValid: boolean;
  attestationExpired: boolean;
  verificationStatus: Proof["attestation"] extends infer A
    ? A extends { verificationStatus: infer S }
      ? S
      : "invalid_state"
    : "invalid_state";
  revoked: boolean;
  trustedIssuerValid: boolean;
  onChainCommitmentConfigured: boolean;
  onChainCommitmentValid: boolean;
  onChainCommitmentStatus: NonNullable<Proof["onChainCommitment"]>["status"];
};

type AuditAction = "proof.issue" | "proof.verify" | "proof.revoke" | "request.replay_blocked" | "request.validation_failed";

type ProofCommitment = {
  proofHash: string;
  proofId: string;
  tenantWallet: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
};

type ProofCommitmentRecord = {
  configured: boolean;
  status: NonNullable<Proof["onChainCommitment"]>["status"];
  proofHash: string;
  transactionSignature?: string;
  slot?: number;
  commitmentAddress?: string;
  committedAt?: string;
  settlementType?: "program" | "memo";
  reason?: string;
  commitment?: ProofCommitment;
};

export type AuditEvent = {
  id: string;
  action: AuditAction;
  proofId?: string;
  propertyId?: string;
  tenantWallet?: string;
  payloadCommitment?: string;
  outcome: "accepted" | "rejected";
  createdAt: string;
  detail: string;
};

const encoder = new TextEncoder();
const PROOF_TTL_DAYS = 30;
const NONCE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const REQUEST_FUTURE_SKEW_MS = 60 * 1000;
const MAX_AUDIT_EVENTS = 200;
const verifierProgram = "ProofRentVerifier111111111111111111111111111111";
const serviceSigningSeed = process.env.PROOFRENT_SIGNING_SEED
  ? createHash("sha256").update(process.env.PROOFRENT_SIGNING_SEED).digest()
  : randomBytes(32);
const serviceKeypair = nacl.sign.keyPair.fromSeed(serviceSigningSeed);
const servicePublicKey = bs58.encode(serviceKeypair.publicKey);
const trustedProofIssuerPublicKey = process.env.SERVER_PROOF_ISSUER_PUBLIC_KEY?.trim() || servicePublicKey;

const nonceStore = new Map<string, { expiresAt: number; consumed: boolean }>();
const revokedProofs = new Map<string, string>();
const issuedProofs = new Map<string, Proof>();
const auditLog: AuditEvent[] = [];

const ordered = <T extends Record<string, unknown>>(value: T): T =>
  Object.keys(value)
    .sort()
    .reduce((result, key) => ({ ...result, [key]: value[key] }), {} as T);

const randomHex = (length: number) => randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);

const generateProofId = () => `0x${randomHex(12 + Math.floor(Math.random() * 5))}`;

const solanaRpcUrl = () => process.env.SERVER_SOLANA_RPC_URL?.trim() ?? process.env.SOLANA_RPC_URL?.trim();
const solanaPayerSecret = () => process.env.SERVER_SOLANA_PAYER_SECRET_KEY?.trim() ?? process.env.SOLANA_PAYER_SECRET_KEY?.trim();
export const isSolanaSettlementConfigured = () => Boolean(solanaRpcUrl() && solanaPayerSecret());

const notConfiguredCommitment = (proofHash: string, commitment?: ProofCommitment): ProofCommitmentRecord => ({
  configured: false,
  status: "not_configured",
  proofHash,
  reason: "Solana settlement not configured",
  commitment,
});

const commitmentFromProof = (proof: Proof): ProofCommitmentRecord | undefined => {
  if (!proof.proofHash) return undefined;
  if (!isSolanaSettlementConfigured()) return notConfiguredCommitment(proof.proofHash);
  if (!proof.onChainCommitment) {
    return {
      configured: true,
      status: "missing",
      proofHash: proof.proofHash,
      reason: "No Solana commitment found for this proof",
    };
  }
  return {
    configured: proof.onChainCommitment.configured,
    status: proof.onChainCommitment.status,
    proofHash: proof.proofHash,
    transactionSignature: proof.onChainCommitment.transactionSignature,
    slot: proof.onChainCommitment.slot,
    commitmentAddress: proof.onChainCommitment.commitmentAddress,
    committedAt: proof.onChainCommitment.committedAt,
    settlementType: proof.onChainCommitment.settlementType,
    reason: proof.onChainCommitment.reason,
  };
};

const settleCommitment = async (commitment: ProofCommitment): Promise<ProofCommitmentRecord> => {
  if (!isSolanaSettlementConfigured()) return notConfiguredCommitment(commitment.proofHash, commitment);
  const { settleProofCommitment } = await import("./solana/proofCommitmentRegistry.js");
  return settleProofCommitment(commitment);
};

const revokeCommitment = async (proofHash: string): Promise<ProofCommitmentRecord> => {
  if (!isSolanaSettlementConfigured()) return notConfiguredCommitment(proofHash);
  const { revokeProofCommitment } = await import("./solana/proofCommitmentRegistry.js");
  return revokeProofCommitment(proofHash);
};

const decodeSolanaPublicKey = (value: string) => {
  const decoded = bs58.decode(value);
  if (decoded.length !== 32) throw new Error("Invalid Solana public key length.");
  return decoded;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const audit = (event: Omit<AuditEvent, "id" | "createdAt">) => {
  auditLog.unshift({
    ...event,
    id: `audit_${randomHex(10)}`,
    createdAt: new Date().toISOString(),
  });

  if (auditLog.length > MAX_AUDIT_EVENTS) {
    auditLog.length = MAX_AUDIT_EVENTS;
  }
};

const cleanExpiredNonces = (now = Date.now()) => {
  for (const [nonceKey, state] of nonceStore.entries()) {
    if (state.expiresAt <= now) nonceStore.delete(nonceKey);
  }
};

const requestMessage = (request: ProofIssueRequest) =>
  [
    "ProofRent verification request",
    `tenantWallet: ${request.tenantWallet}`,
    `propertyId: ${request.propertyId}`,
    `timestamp: ${request.timestamp}`,
    `nonce: ${request.nonce}`,
  ].join("\n");

const proofPayload = (proof: Proof) =>
  JSON.stringify(
    ordered({
      attestationStatus: proof.attestationStatus,
      checks: ordered(proof.checks),
      compatibleRentRange: ordered(proof.compatibleRentRange),
      expiresAt: proof.expiresAt,
      issuedAt: proof.issuedAt,
      proofId: proof.proofId || proof.id,
      propertyIds: proof.propertyIds,
      riskCategory: proof.riskCategory,
      tenantWallet: proof.tenantWallet,
      issuerPublicKey: proof.issuerPublicKey,
    }),
  );

const proofMessage = (proof: Proof) => `ProofRent signed rental proof\n${proofPayload(proof)}`;

const hashText = (value: string) => `sha512_${Buffer.from(nacl.hash(encoder.encode(value))).toString("hex")}`;

const proofHash = (proof: Proof) => hashText(proofMessage(proof));

const attestationPayload = (attestation: NonNullable<Proof["attestation"]>) =>
  JSON.stringify(
    ordered({
      attestationId: attestation.attestationId,
      executionEnvironment: attestation.executionEnvironment,
      expiresAt: attestation.expiresAt,
      issuedAt: attestation.issuedAt,
      issuer: attestation.issuer,
      issuerPublicKey: attestation.issuerPublicKey,
      proofHash: attestation.proofHash,
    }),
  );

const attestationMessage = (attestation: NonNullable<Proof["attestation"]>) =>
  `ProofRent simulated confidential execution attestation\n${attestationPayload(attestation)}`;

const attestationHash = (attestation: NonNullable<Proof["attestation"]>) => hashText(attestationMessage(attestation));

const getProofIssuer = (proof: Proof) => proof.issuerPublicKey ?? proof.signature?.signer;
const getAttestationIssuer = (proof: Proof) => proof.attestation?.issuerPublicKey ?? proof.attestation?.issuer;
const getAttestationSignature = (proof: Proof) => proof.attestation?.attestationSignature ?? proof.attestation?.signature;

const verifyTrustedIssuer = (proof: Proof) => {
  const proofIssuer = getProofIssuer(proof);
  const attestationIssuer = getAttestationIssuer(proof);
  const attestationSignature = getAttestationSignature(proof);

  if (!proofIssuer || !attestationIssuer || !proof.signature?.signer || !attestationSignature?.signer) {
    return { valid: false, reason: "Proof is missing required issuer fields." };
  }
  if (proofIssuer !== trustedProofIssuerPublicKey || attestationIssuer !== trustedProofIssuerPublicKey) {
    return { valid: false, reason: "Proof was signed by an unknown issuer." };
  }
  if (proof.signature.signer !== trustedProofIssuerPublicKey || attestationSignature.signer !== trustedProofIssuerPublicKey) {
    return { valid: false, reason: "Proof or attestation signature was not produced by the trusted issuer." };
  }
  if (proof.attestation?.issuer && proof.attestation.issuer !== trustedProofIssuerPublicKey) {
    return { valid: false, reason: "Attestation issuer field was modified." };
  }

  return { valid: true, reason: "Trusted issuer verified." };
};

const signProof = (proof: Proof): Proof["signature"] => {
  const message = proofMessage(proof);
  const signature = nacl.sign.detached(encoder.encode(message), serviceKeypair.secretKey);

  return {
    scheme: "ed25519",
    signer: servicePublicKey,
    value: bs58.encode(signature),
    message,
  };
};

const signAttestation = (attestation: Omit<NonNullable<Proof["attestation"]>, "signature">): NonNullable<Proof["signature"]> => {
  const message = attestationMessage({
    ...attestation,
    signature: {
      scheme: "ed25519",
      signer: servicePublicKey,
      value: "",
      message: "",
    },
  });
  const signature = nacl.sign.detached(encoder.encode(message), serviceKeypair.secretKey);

  return {
    scheme: "ed25519",
    signer: servicePublicKey,
    value: bs58.encode(signature),
    message,
  };
};

const validateNumber = (value: unknown, field: string, errors: string[]) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${field} must be a non-negative number.`);
  }
};

const nonceKey = (tenantWallet: string, nonce: string) => `${tenantWallet}:${nonce}`;

const rejectIssueRequest = (request: Partial<ProofIssueRequest>, detail: string): never => {
  audit({
    action: detail.toLowerCase().includes("nonce") ? "request.replay_blocked" : "request.validation_failed",
    propertyId: request.propertyId,
    tenantWallet: request.tenantWallet,
    payloadCommitment: request.protectedPayload?.payloadCommitment,
    outcome: "rejected",
    detail,
  });
  throw new Error(detail);
};

const validateRequestAuthorization = (request: Partial<ProofIssueRequest>, now = Date.now()) => {
  const errors: string[] = [];

  if (!request.tenantWallet || typeof request.tenantWallet !== "string") errors.push("tenantWallet is required.");
  if (!request.propertyId || typeof request.propertyId !== "string") errors.push("propertyId is required.");
  if (!request.timestamp || typeof request.timestamp !== "string") errors.push("timestamp is required.");
  if (!request.nonce || typeof request.nonce !== "string" || request.nonce.length < 16) {
    errors.push("nonce must be at least 16 characters.");
  }
  if (!request.requestMessage || typeof request.requestMessage !== "string") {
    errors.push("requestMessage is required.");
  }
  if (!request.requestSignature || typeof request.requestSignature !== "object") {
    errors.push("requestSignature is required.");
  } else {
    if (request.requestSignature.scheme !== "ed25519") errors.push("requestSignature.scheme must be ed25519.");
    if (!request.requestSignature.signer || request.requestSignature.signer !== request.tenantWallet) {
      errors.push("requestSignature signer must match tenantWallet.");
    }
    if (!request.requestSignature.value || typeof request.requestSignature.value !== "string") {
      errors.push("requestSignature.value is required.");
    }
    if (request.requestSignature.message && request.requestSignature.message !== request.requestMessage) {
      errors.push("requestSignature.message must match requestMessage.");
    }
  }

  try {
    if (request.tenantWallet) decodeSolanaPublicKey(request.tenantWallet);
  } catch {
    errors.push("tenantWallet must be a valid Solana public key.");
  }

  const timestampMs = typeof request.timestamp === "string" ? Date.parse(request.timestamp) : Number.NaN;
  if (Number.isNaN(timestampMs)) {
    errors.push("timestamp must be a valid ISO date.");
  } else if (timestampMs <= now - REQUEST_TTL_MS || timestampMs > now + REQUEST_FUTURE_SKEW_MS) {
    errors.push("request timestamp is expired.");
  }

  if (errors.length > 0) rejectIssueRequest(request, errors.join(" "));

  const typedRequest = request as ProofIssueRequest;
  if (typedRequest.requestMessage !== requestMessage(typedRequest)) {
    rejectIssueRequest(typedRequest, "requestMessage does not match the required ProofRent verification request.");
  }

  cleanExpiredNonces(now);
  const key = nonceKey(typedRequest.tenantWallet, typedRequest.nonce);
  if (nonceStore.has(key)) {
    rejectIssueRequest(typedRequest, "Replay protection rejected this proof request nonce.");
  }

  if (!verifyRequestSignature(typedRequest)) {
    rejectIssueRequest(typedRequest, "Tenant request signature is invalid.");
  }

  nonceStore.set(key, {
    expiresAt: now + NONCE_TTL_MS,
    consumed: false,
  });
};

export const validateIssueRequest = (body: unknown): ProofIssueRequest => {
  const errors: string[] = [];
  const request = body as Partial<ProofIssueRequest>;

  if (!request || typeof request !== "object") errors.push("Request body is required.");
  if (errors.length > 0) rejectIssueRequest({}, errors.join(" "));

  validateRequestAuthorization(request);

  validateNumber(request.rent, "rent", errors);
  if (!request.protectedPayload || typeof request.protectedPayload !== "object") {
    errors.push("protectedPayload is required.");
  } else {
    if (!request.protectedPayload.payloadCommitment || typeof request.protectedPayload.payloadCommitment !== "string") {
      errors.push("protectedPayload.payloadCommitment is required.");
    }
    if (request.protectedPayload.mode === "local-plaintext-demo") {
      if (request.protectedPayload.encryptionContext !== "local-plaintext-demo") {
        errors.push("Local simulation payload must use local-plaintext-demo context.");
      }
      if (!request.protectedPayload.plaintextProfile || typeof request.protectedPayload.plaintextProfile !== "object") {
        errors.push("protectedPayload.plaintextProfile is required for plaintext local demo mode.");
      } else {
        validateNumber(request.protectedPayload.plaintextProfile.monthlyIncome, "monthlyIncome", errors);
        validateNumber(request.protectedPayload.plaintextProfile.monthlyExpenses, "monthlyExpenses", errors);
        validateNumber(request.protectedPayload.plaintextProfile.savings, "savings", errors);
        validateNumber(request.protectedPayload.plaintextProfile.monthlyDebt, "monthlyDebt", errors);
      }
    } else if (request.protectedPayload.mode === "magicblock-encrypted") {
      if (request.protectedPayload.encryptionContext !== "magicblock-rsa-oaep-sha256") {
        errors.push("MagicBlock encrypted payload must use magicblock-rsa-oaep-sha256 context.");
      }
      if (!request.protectedPayload.encryptedPayload || typeof request.protectedPayload.encryptedPayload !== "string") {
        errors.push("protectedPayload.encryptedPayload is required for MagicBlock encrypted mode.");
      }
      if (request.protectedPayload.plaintextProfile) {
        errors.push("MagicBlock encrypted mode must not include plaintext financial profile.");
      }
    } else {
      errors.push("protectedPayload.mode is unsupported.");
    }
  }

  if (errors.length > 0) {
    rejectIssueRequest(request, errors.join(" "));
  }

  return request as ProofIssueRequest;
};

const verifyRequestSignature = (request: ProofIssueRequest) => {
  if (!request.requestSignature) return false;
  if (request.requestSignature.scheme !== "ed25519") return false;
  if (request.requestSignature.signer !== request.tenantWallet) return false;
  if (request.requestMessage !== requestMessage(request)) return false;
  if (request.requestSignature.message && request.requestSignature.message !== request.requestMessage) return false;

  try {
    const publicKeyBytes = decodeSolanaPublicKey(request.tenantWallet);
    return nacl.sign.detached.verify(
      encoder.encode(request.requestMessage),
      bs58.decode(request.requestSignature.value),
      publicKeyBytes,
    );
  } catch {
    return false;
  }
};

const evaluatePrivateSignals = (rent: number, privateSignals: PrivateFinancialProfile) => {
  const { monthlyIncome, monthlyExpenses, savings, monthlyDebt } = privateSignals;
  const compatibleMaxRent = Math.max(
    0,
    Math.floor(
      Math.min(
        monthlyIncome / 2.5,
        (monthlyIncome - monthlyExpenses) / 1.3,
        savings / 2,
      ),
    ),
  );
  const checks = {
    incomeCheck: monthlyIncome >= rent * 2.5 ? "passed" : "failed",
    cashflowCheck: monthlyIncome - monthlyExpenses >= rent * 1.3 ? "passed" : "failed",
    savingsCheck: savings >= rent * 2 ? "passed" : "failed",
    debtCheck: monthlyDebt <= monthlyIncome * 0.4 ? "passed" : "failed",
  } as Proof["checks"];

  const approved = Object.values(checks).every((check) => check === "passed");
  const score =
    (monthlyIncome >= rent * 3 ? 35 : 0) +
    (savings >= rent * 2 ? 25 : 0) +
    (monthlyExpenses < monthlyIncome * 0.5 ? 25 : 0) +
    (monthlyDebt < monthlyIncome * 0.2 ? 15 : 0);

  return {
    checks,
    score,
    status: approved ? "Tenant Verified" : "Not Verified",
    riskLevel: approved ? (score >= 75 ? "low" : "medium") : "high",
    riskCategory: approved ? (score >= 75 ? "low" : "medium") : "high",
    compatibleRentRange: {
      min: 0,
      max: compatibleMaxRent,
    },
  } satisfies Pick<Proof, "checks" | "score" | "status" | "riskLevel" | "riskCategory" | "compatibleRentRange">;
};

export const issueProof = async (request: ProofIssueRequest) => {
  cleanExpiredNonces();
  const key = nonceKey(request.tenantWallet, request.nonce);
  const nonceState =
    nonceStore.get(key) ??
    rejectIssueRequest(request, "Replay protection rejected this proof request nonce.");
  if (nonceState.consumed) {
    rejectIssueRequest(request, "Replay protection rejected this proof request nonce.");
  }
  nonceState.consumed = true;

  let execution: ReturnType<typeof evaluatePrivateSignals>;
  let executionProvider = "Simulated local confidential execution";
  let executionMetadata: Proof["executionMetadata"] = {
    provider: "local-simulation",
    executionMode: "simulation",
    attestationVerified: false,
    accessTokenUsed: false,
    executionEnvironment: "Local simulated confidential execution",
    issuedAt: new Date().toISOString(),
  };
  let attestationProvider = "ProofRent local attestation adapter";
  let attestationExecutionEnvironment = "Local simulated confidential execution adapter; MagicBlock PER integration pending";
  let attestationQuoteId = `local_quote_${randomHex(16)}`;
  let attestationMeasurement = `proofrent_eval_${randomHex(24)}`;

  if (request.protectedPayload.mode === "magicblock-encrypted") {
    const magicBlockConfig = getMagicBlockServerConfig();
    const executionMode = getMagicBlockMode(magicBlockConfig);
    if (executionMode !== "magicblock-real") {
      throw new Error(
        "MagicBlock encrypted mode requires MAGICBLOCK_PER_RPC_URL, MAGICBLOCK_ATTESTATION_URL, and MAGICBLOCK_ACCESS_TOKEN_URL. Encrypted payloads cannot run in local simulation.",
      );
    }

    const { MagicBlockPERAdapter } = await import("./magicblock/MagicBlockPERAdapter.js");
    const adapterResult = await new MagicBlockPERAdapter(magicBlockConfig).executePrivateProofJob({
      propertyId: request.propertyId,
      rent: request.rent,
      tenantWallet: request.tenantWallet,
      encryptedPayload: request.protectedPayload.encryptedPayload,
      payloadCommitment: request.protectedPayload.payloadCommitment,
      accessToken: request.magicBlockAccess?.accessToken,
      permissionGroup: request.magicBlockAccess?.permissionGroup,
    });

    if (adapterResult.executionMode !== "magicblock-real" || adapterResult.executionReceipt.provider !== "magicblock-per") {
      throw new Error("MagicBlock PER adapter did not return a real MagicBlock execution receipt.");
    }
    if (!adapterResult.runtimeId || !adapterResult.measurementHash || !adapterResult.proofResult) {
      throw new Error("MagicBlock PER adapter returned incomplete proof execution evidence.");
    }
    if (!adapterResult.attestationEvidence.attestationVerified) {
      throw new Error("MagicBlock PER attestation was not verified; refusing to issue signed proof.");
    }

    execution = adapterResult.proofResult;
    executionProvider = "Executed via MagicBlock PER";
    executionMetadata = {
      provider: "magicblock-per",
      executionMode: adapterResult.executionMode,
      runtimeId: adapterResult.runtimeId,
      measurementHash: adapterResult.measurementHash,
      attestationVerified: adapterResult.attestationEvidence.attestationVerified,
      accessTokenUsed: Boolean(request.magicBlockAccess?.accessToken),
      executionEnvironment: `MagicBlock PER runtime ${adapterResult.runtimeId}`,
      issuedAt: adapterResult.executionReceipt.issuedAt,
    };
    attestationProvider = "MagicBlock PER";
    attestationExecutionEnvironment = executionMetadata.executionEnvironment;
    attestationQuoteId = adapterResult.attestationEvidence.tdxQuoteHash;
    attestationMeasurement = adapterResult.measurementHash;
  } else {
    execution = evaluatePrivateSignals(request.rent, request.protectedPayload.plaintextProfile!);
  }

  const issuedAt = new Date();
  const expiresAt = addDays(issuedAt, PROOF_TTL_DAYS);
  const proofId = generateProofId();
  const proof: Proof = {
    id: proofId,
    proofId,
    tenantWallet: request.tenantWallet,
    propertyId: request.propertyId,
    propertyIds: [request.propertyId],
    ...execution,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    validity: "active",
    issuerPublicKey: servicePublicKey,
    payloadCommitment: request.protectedPayload.payloadCommitment,
    executionProvider,
    executionMetadata,
    attestationStatus: "attested",
    verifierProgram,
    selectiveDisclosure: [
      "proofId",
      "tenantWallet",
      "propertyIds",
      "compatibleRentRange",
      "riskCategory",
      "validity",
      "expiresAt",
      "attestationStatus",
    ],
    shareUrlPath: `/verify-proof/${proofId}`,
    validUntil: expiresAt.toISOString(),
    createdAt: issuedAt.toISOString(),
  };

  proof.proofHash = proofHash(proof);
  proof.signature = signProof(proof);
  const unsignedAttestation = {
    attestationId: `att_${randomHex(16)}`,
    proofHash: proof.proofHash,
    issuer: servicePublicKey,
    issuerPublicKey: servicePublicKey,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    executionEnvironment: attestationExecutionEnvironment,
    verificationStatus: "verified" as const,
    provider: attestationProvider,
    quoteId: attestationQuoteId,
    measurement: attestationMeasurement,
  };
  const unsignedAttestationWithHash = {
    ...unsignedAttestation,
    attestationHash: attestationHash({
      ...unsignedAttestation,
      signature: {
        scheme: "ed25519" as const,
        signer: servicePublicKey,
        value: "",
        message: "",
      },
      verificationStatus: "verified" as const,
    }),
  };
  proof.attestation = {
    ...unsignedAttestationWithHash,
    signature: signAttestation(unsignedAttestationWithHash),
    attestationSignature: signAttestation(unsignedAttestationWithHash),
  };
  const verification = verifyProof(proof);
  issuedProofs.set(proofId, proof);

  audit({
    action: "proof.issue",
    proofId,
    propertyId: request.propertyId,
    tenantWallet: request.tenantWallet,
    payloadCommitment: request.protectedPayload.payloadCommitment,
    outcome: verification.valid ? "accepted" : "rejected",
    detail: "Proof issued from ephemeral in-memory execution; raw financial fields were discarded after this request.",
  });

  // Simulated confidential state boundary:
  // Raw income, savings, expenses and debt exist only on the stack for this request.
  // Do not add persistence, local files, databases, or raw-value audit logging here.
  return {
    proof,
    attestationMetadata: proof.attestation,
    verification,
    validityPeriod: {
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt,
      validDays: PROOF_TTL_DAYS,
    },
  };
};

const attachOnChainCommitment = (proof: Proof, commitment: ProofCommitmentRecord) => {
  proof.onChainCommitment = {
    configured: commitment.configured,
    status: commitment.status,
    transactionSignature: commitment.transactionSignature,
    slot: commitment.slot,
    commitmentAddress: commitment.commitmentAddress,
    committedAt: commitment.committedAt,
    settlementType: commitment.settlementType,
    reason: commitment.reason,
  };
  proof.solanaTxSignature = commitment.transactionSignature;
  proof.commitmentStatus = commitment.status;
  proof.committedAt = commitment.committedAt;
};

export const issueProofWithSettlement = async (request: ProofIssueRequest) => {
  const result = await issueProof(request);
  if (result.proof.proofHash) {
    const commitmentPayload = {
      proofHash: result.proof.proofHash,
      proofId: result.proof.proofId || result.proof.id,
      tenantWallet: result.proof.tenantWallet,
      issuer: result.proof.issuerPublicKey ?? servicePublicKey,
      issuedAt: result.proof.issuedAt,
      expiresAt: result.proof.expiresAt,
      revoked: false,
    };
    const commitment = await settleCommitment(commitmentPayload);
    attachOnChainCommitment(result.proof, commitment);
    issuedProofs.set(result.proof.proofId || result.proof.id, result.proof);
  }
  result.verification = verifyProof(result.proof);
  return result;
};

export const verifyProof = (proof: Proof, now = new Date()): ProofVerificationResult => {
  const expired = Date.parse(proof.expiresAt) <= now.getTime();
  const attestationExpired = proof.attestation ? Date.parse(proof.attestation.expiresAt) <= now.getTime() : true;
  const revoked = revokedProofs.has(proof.proofId || proof.id) || proof.validity === "revoked" || Boolean(proof.revokedAt);
  const trustedIssuer = verifyTrustedIssuer(proof);
  const expectedProofHash = proofHash(proof);
  const attestationSignature = getAttestationSignature(proof);
  const integrityValid =
    proof.id === proof.proofId &&
    proof.signature?.scheme === "ed25519" &&
    proof.signature.message === proofMessage(proof) &&
    proof.issuerPublicKey === trustedProofIssuerPublicKey &&
    proof.proofHash === expectedProofHash &&
    proof.attestationStatus === "attested" &&
    Boolean(proof.attestation?.attestationId) &&
    proof.attestation?.issuerPublicKey === trustedProofIssuerPublicKey &&
    proof.attestation?.issuer === trustedProofIssuerPublicKey &&
    proof.attestation?.attestationHash === (proof.attestation ? attestationHash(proof.attestation) : "") &&
    attestationSignature?.message === (proof.attestation ? attestationMessage(proof.attestation) : "") &&
    typeof proof.compatibleRentRange?.max === "number" &&
    Array.isArray(proof.propertyIds) &&
    !Number.isNaN(Date.parse(proof.issuedAt)) &&
    !Number.isNaN(Date.parse(proof.expiresAt));
  const proofHashValid = Boolean(proof.attestation) && proof.attestation?.proofHash === expectedProofHash && proof.proofHash === expectedProofHash;

  let signatureValid = false;
  if (integrityValid && proof.signature) {
    try {
      signatureValid = nacl.sign.detached.verify(
        encoder.encode(proofMessage(proof)),
        bs58.decode(proof.signature.value),
        bs58.decode(proof.signature.signer),
      );
    } catch {
      signatureValid = false;
    }
  }

  let attestationSignatureValid = false;
  if (proof.attestation && attestationSignature?.scheme === "ed25519") {
    try {
      attestationSignatureValid =
        attestationSignature.message === attestationMessage(proof.attestation) &&
        nacl.sign.detached.verify(
          encoder.encode(attestationMessage(proof.attestation)),
          bs58.decode(attestationSignature.value),
          bs58.decode(attestationSignature.signer),
        );
    } catch {
      attestationSignatureValid = false;
    }
  }

  const commitmentStatus = commitmentFromProof(proof);
  if (commitmentStatus) attachOnChainCommitment(proof, commitmentStatus);
  const onChainCommitmentConfigured = Boolean(commitmentStatus?.configured);
  const onChainCommitmentValid =
    !onChainCommitmentConfigured ||
    commitmentStatus?.status === "settled";

  const verificationStatus: ProofVerificationResult["verificationStatus"] = !integrityValid
    ? "tampered"
    : !trustedIssuer.valid || !signatureValid || !attestationSignatureValid
      ? "invalid_signature"
    : !proofHashValid
      ? "tampered"
        : expired || attestationExpired
          ? "expired"
          : revoked
            ? "invalid_state"
            : !onChainCommitmentValid
              ? "invalid_state"
              : "verified";

  if (proof.attestation) proof.attestation.verificationStatus = verificationStatus;

  const valid = verificationStatus === "verified";
  return {
    valid,
    reason:
      verificationStatus === "tampered"
        ? "Proof hash or integrity fields do not match the signed attestation."
        : verificationStatus === "invalid_signature"
          ? trustedIssuer.valid
            ? "Proof or attestation signature failed service verification."
            : trustedIssuer.reason
        : verificationStatus === "expired"
          ? "Proof or attestation has expired."
          : verificationStatus === "invalid_state"
            ? revoked
              ? "Proof is revoked."
              : onChainCommitmentConfigured
                ? "No on-chain commitment found for this proof."
                : "Proof is not in an active reusable state."
            : "Proof integrity, expiration, proof hash, and signatures are valid.",
    expired,
    signatureValid,
    integrityValid,
    proofHashValid,
    attestationSignatureValid,
    attestationExpired,
    verificationStatus,
    revoked,
    trustedIssuerValid: trustedIssuer.valid,
    onChainCommitmentConfigured,
    onChainCommitmentValid,
    onChainCommitmentStatus: commitmentStatus?.status ?? "not_configured",
  };
};

export const revokeProof = (proofId: string, reason: string) => {
  revokedProofs.set(proofId, reason || "Revoked by proof owner or verifier.");
  const proof = issuedProofs.get(proofId);
  if (proof) {
    proof.validity = "revoked";
    proof.revokedAt = new Date().toISOString();
    proof.revocationReason = reason || "Revoked by proof owner or verifier.";
  }
  audit({
    action: "proof.revoke",
    proofId,
    outcome: "accepted",
    detail: reason || "Proof revoked.",
  });
};

export const revokeProofWithSettlement = async (proofId: string, reason: string) => {
  revokeProof(proofId, reason);
  const proof = issuedProofs.get(proofId);
  if (proof?.proofHash) {
    const commitment = await revokeCommitment(proof.proofHash);
    attachOnChainCommitment(proof, commitment);
  }
  return proof;
};

export const getStoredProof = (proofId: string) => issuedProofs.get(proofId);

export const recordVerificationAudit = (proof: Proof, verification: ProofVerificationResult) => {
  audit({
    action: "proof.verify",
    proofId: proof.proofId || proof.id,
    propertyId: proof.propertyId,
    tenantWallet: proof.tenantWallet,
    payloadCommitment: proof.payloadCommitment,
    outcome: verification.valid ? "accepted" : "rejected",
    detail: verification.reason,
  });
};

export const getAuditLog = () => auditLog;
export const getServicePublicKey = () => servicePublicKey;
export const createRequestMessage = requestMessage;
export const clearProofSecurityStateForTests = () => {
  nonceStore.clear();
  revokedProofs.clear();
  issuedProofs.clear();
  auditLog.length = 0;
};
