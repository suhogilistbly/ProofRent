import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

export type ProofCommitment = {
  proofHash: string;
  proofId: string;
  tenantWallet: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
};

export type OnChainCommitmentStatus =
  | "not_configured"
  | "settled"
  | "missing"
  | "revoked"
  | "expired"
  | "failed";

export type ProofCommitmentRecord = {
  configured: boolean;
  status: OnChainCommitmentStatus;
  proofHash: string;
  transactionSignature?: string;
  slot?: number;
  commitmentAddress?: string;
  committedAt?: string;
  settlementType?: "program" | "memo";
  reason?: string;
  commitment?: ProofCommitment;
};

const commitmentStore = new Map<string, ProofCommitmentRecord>();
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const programId = () => process.env.SERVER_PROOFRENT_PROGRAM_ID?.trim();
const rpcUrl = () => process.env.SERVER_SOLANA_RPC_URL?.trim() ?? process.env.SOLANA_RPC_URL?.trim();
const payerSecret = () => process.env.SERVER_SOLANA_PAYER_SECRET_KEY?.trim() ?? process.env.SOLANA_PAYER_SECRET_KEY?.trim();

export const isProofCommitmentConfigured = () => Boolean(rpcUrl() && payerSecret());

const hashSeed = (value: string) => createHash("sha256").update(value).digest();

const parsePayer = (secret: string) => {
  try {
    const parsed = JSON.parse(secret) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(secret));
  }
};

const commitmentAddressFor = async (proofHash: string, registryProgramId: PublicKey) => {
  const [address] = await PublicKey.findProgramAddress(
    [Buffer.from("proofrent"), hashSeed(proofHash)],
    registryProgramId,
  );
  return address;
};

const encodeInstruction = (action: "settle" | "revoke", commitment: ProofCommitment) =>
  Buffer.from(JSON.stringify({ action, commitment }), "utf8");

export class ProofCommitmentService {
  isConfigured() {
    return isProofCommitmentConfigured();
  }

  async settle(commitment: ProofCommitment): Promise<ProofCommitmentRecord> {
    if (!this.isConfigured()) {
      const record: ProofCommitmentRecord = {
        configured: false,
        status: "not_configured",
        proofHash: commitment.proofHash,
        reason: "Solana settlement not configured",
        commitment,
      };
      commitmentStore.set(commitment.proofHash, record);
      return record;
    }

    try {
      const payer = parsePayer(payerSecret()!);
      const connection = new Connection(rpcUrl()!, "confirmed");
      const configuredProgramId = programId();
      const registryProgramId = configuredProgramId ? new PublicKey(configuredProgramId) : undefined;
      const commitmentAddress = registryProgramId
        ? await commitmentAddressFor(commitment.proofHash, registryProgramId)
        : undefined;
      const payload = {
        protocol: "ProofRent",
        version: 1,
        action: commitment.revoked ? "revoke-proof-commitment" : "settle-proof-commitment",
        proofHash: commitment.proofHash,
        proofId: commitment.proofId,
        tenantWallet: commitment.tenantWallet,
        issuer: commitment.issuer,
        expiresAt: commitment.expiresAt,
      };
      const instruction = registryProgramId
        ? new TransactionInstruction({
            programId: registryProgramId,
            keys: [
              { pubkey: commitmentAddress!, isSigner: false, isWritable: true },
              { pubkey: payer.publicKey, isSigner: true, isWritable: true },
              { pubkey: new PublicKey(commitment.tenantWallet), isSigner: false, isWritable: false },
            ],
            data: encodeInstruction(commitment.revoked ? "revoke" : "settle", commitment),
          })
        : new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [],
            data: Buffer.from(JSON.stringify(payload), "utf8"),
          });

      const transaction = new Transaction().add(instruction);
      const transactionSignature = await sendAndConfirmTransaction(connection, transaction, [payer], {
        commitment: "confirmed",
      });
      const parsed = await connection.getSignatureStatus(transactionSignature);
      const record: ProofCommitmentRecord = {
        configured: true,
        status: "settled",
        proofHash: commitment.proofHash,
        transactionSignature,
        slot: parsed.value?.slot,
        commitmentAddress: commitmentAddress?.toBase58(),
        committedAt: new Date().toISOString(),
        settlementType: registryProgramId ? "program" : "memo",
        commitment,
      };
      commitmentStore.set(commitment.proofHash, record);
      return record;
    } catch (error) {
      const record: ProofCommitmentRecord = {
        configured: true,
        status: "failed",
        proofHash: commitment.proofHash,
        reason: error instanceof Error ? error.message : "Solana commitment settlement failed",
        commitment,
      };
      commitmentStore.set(commitment.proofHash, record);
      return record;
    }
  }

  async revoke(proofHash: string): Promise<ProofCommitmentRecord> {
    const existing = commitmentStore.get(proofHash);
    if (!existing || !existing.commitment) {
      return {
        configured: this.isConfigured(),
        status: this.isConfigured() ? "missing" : "not_configured",
        proofHash,
        reason: this.isConfigured() ? "No Solana commitment found for this proof" : "Solana settlement not configured",
      };
    }

    const revokedCommitment = { ...existing.commitment, revoked: true };
    if (!this.isConfigured()) {
      const record = {
        ...existing,
        configured: false,
        status: "not_configured" as const,
        reason: "Solana settlement not configured",
        commitment: revokedCommitment,
      };
      commitmentStore.set(proofHash, record);
      return record;
    }

    const settlement = await this.settle(revokedCommitment);
    const record = {
      ...settlement,
      status: settlement.status === "settled" ? ("revoked" as const) : settlement.status,
      commitment: revokedCommitment,
    };
    commitmentStore.set(proofHash, record);
    return record;
  }

  verify(proofHash: string): ProofCommitmentRecord {
    const existing = commitmentStore.get(proofHash);
    if (!existing) {
      return {
        configured: this.isConfigured(),
        status: this.isConfigured() ? "missing" : "not_configured",
        proofHash,
        reason: this.isConfigured() ? "No Solana commitment found for this proof" : "Solana settlement not configured",
      };
    }

    if (existing.commitment?.revoked) return { ...existing, status: "revoked" };
    if (existing.commitment?.expiresAt && Date.parse(existing.commitment.expiresAt) <= Date.now()) {
      return { ...existing, status: "expired" };
    }
    return existing;
  }
}

const proofCommitmentService = new ProofCommitmentService();

export const revokeProofCommitment = async (proofHash: string): Promise<ProofCommitmentRecord> => {
  return proofCommitmentService.revoke(proofHash);
};

export const verifyProofCommitment = (proofHash: string): ProofCommitmentRecord => {
  return proofCommitmentService.verify(proofHash);
};

export const settleProofCommitment = async (commitment: ProofCommitment): Promise<ProofCommitmentRecord> =>
  proofCommitmentService.settle(commitment);

export const clearProofCommitmentStoreForTests = () => {
  commitmentStore.clear();
};
