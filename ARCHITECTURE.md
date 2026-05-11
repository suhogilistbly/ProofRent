# Architecture Notes

ProofRent has three boundaries:

1. Frontend UX: collects demo inputs, requests wallet signatures, displays sanitized proof and application flows.
2. Proof service: validates signed requests, evaluates the rental policy, issues signed proofs, verifies proofs, and records sanitized audit events.
3. Optional settlement/integration adapters: MagicBlock PER adapter and Solana proof commitment adapter.

## Proof Flow

Tenant inputs become a protected payload. In local demo mode this is explicitly labeled plaintext simulation. If MagicBlock execution keys and backend endpoints are configured, the frontend creates an encrypted MagicBlock payload. The backend refuses encrypted mode unless MagicBlock PER configuration is present and verified.

The proof service signs only sanitized fields. Landlord and public views verify proof hash, issuer, signature, attestation signature, expiry, revocation, and optional on-chain commitment status.

## Acceptance Rule

Landlord acceptance is allowed only after backend verification succeeds. Local checks can help explain state, but they are not sufficient to unlock contact details.

## MagicBlock Rule

The UI shows a MagicBlock PER success label only when backend proof metadata says `provider = magicblock-per` and `attestationVerified = true`. Otherwise the proof is shown as simulation/local adapter mode.
