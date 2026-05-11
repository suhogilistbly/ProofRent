import type { Application, Proof, Property } from "./types";
import { proofHash } from "./proofCrypto";

const PROPERTY_KEY = "proofrent.properties";
const PROOF_KEY = "proofrent.proofs";
const APPLICATION_KEY = "proofrent.applications";

const apartmentImage = (accent: string, wall: string, floor: string, view: string) =>
  `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
      <defs>
        <linearGradient id="sun" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#f8fbff"/>
          <stop offset="1" stop-color="${wall}"/>
        </linearGradient>
        <linearGradient id="floor" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="${floor}"/>
          <stop offset="1" stop-color="#d6c3a8"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#sun)"/>
      <rect y="610" width="1200" height="290" fill="url(#floor)"/>
      <rect x="92" y="96" width="430" height="420" rx="18" fill="#f7fbff" stroke="#d4e2ee" stroke-width="12"/>
      <rect x="122" y="126" width="170" height="360" fill="${view}"/>
      <rect x="322" y="126" width="170" height="360" fill="${view}"/>
      <path d="M122 405c130-90 224-88 370-12v93H122z" fill="#b9d2c0" opacity=".7"/>
      <path d="M118 486h378" stroke="#d4e2ee" stroke-width="10"/>
      <rect x="650" y="340" width="350" height="170" rx="28" fill="${accent}"/>
      <rect x="690" y="300" width="92" height="70" rx="16" fill="#f5f7fb"/>
      <rect x="822" y="300" width="92" height="70" rx="16" fill="#f5f7fb"/>
      <rect x="620" y="500" width="430" height="85" rx="28" fill="#f8fafc"/>
      <rect x="706" y="585" width="34" height="112" rx="12" fill="#7c5f44"/>
      <rect x="930" y="585" width="34" height="112" rx="12" fill="#7c5f44"/>
      <rect x="215" y="545" width="255" height="42" rx="21" fill="#182335"/>
      <rect x="238" y="585" width="205" height="58" rx="16" fill="#f8fafc"/>
      <rect x="250" y="643" width="28" height="72" rx="10" fill="#6f5742"/>
      <rect x="404" y="643" width="28" height="72" rx="10" fill="#6f5742"/>
      <circle cx="1020" cy="222" r="50" fill="#ffffff" opacity=".8"/>
      <path d="M0 730c280-60 508-58 760 0s338 54 440 18v152H0z" fill="#ffffff" opacity=".22"/>
    </svg>
  `)}`;

// Browser storage is limited to public listings, sanitized proofs, and application shell state.
// Raw income, savings, expenses, debt, provider records, and protected payloads stay out of localStorage.
export const starterProperties: Property[] = [
  {
    id: "modern-studio-apartment",
    title: "Modern Studio Apartment",
    location: "Riverside District",
    rent: 800,
    description:
      "A bright, efficient studio with modern finishes, natural light, and quick access to transit.",
    image: apartmentImage("#0f766e", "#dbeafe", "#c8b18f", "#c7e2f3"),
    requirements: ["Tenant must prove income stability and ability to pay rent."],
  },
  {
    id: "city-center-loft",
    title: "City Center Loft",
    location: "Downtown Core",
    rent: 1200,
    description:
      "An open-plan loft close to restaurants, offices, and nightlife, with tall windows and flexible living space.",
    image: apartmentImage("#312e81", "#ede9fe", "#caa875", "#b8c7dc"),
    requirements: ["Tenant must prove income stability and ability to pay rent."],
  },
  {
    id: "family-apartment",
    title: "Family Apartment",
    location: "Greenwood Heights",
    rent: 1600,
    description:
      "A comfortable multi-room apartment near schools, parks, and daily essentials, designed for longer stays.",
    image: apartmentImage("#9a3412", "#fef3c7", "#b88c5a", "#b7d9c0"),
    requirements: ["Tenant must prove income stability and ability to pay rent."],
  },
];

const read = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = <T,>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const normalizeProof = (proof: Proof): Proof => {
  const property = starterProperties.find((item) => item.id === proof.propertyId);
  const compatibleRentRange = proof.compatibleRentRange ?? {
    min: 0,
    max: property?.rent ?? 0,
  };

  const attestationIssuedAt = proof.attestation?.issuedAt ?? proof.issuedAt;
  const attestationExpiresAt = proof.attestation?.expiresAt ?? proof.expiresAt;
  const normalizedForHash = {
    ...proof,
    propertyIds: proof.propertyIds ?? [proof.propertyId],
    compatibleRentRange,
    riskCategory: proof.riskCategory ?? proof.riskLevel,
    attestationStatus: proof.attestationStatus === "failed" ? ("failed" as const) : ("attested" as const),
  };

  return {
    ...proof,
    propertyIds: proof.propertyIds ?? [proof.propertyId],
    compatibleRentRange,
    riskCategory: proof.riskCategory ?? proof.riskLevel,
    validity: proof.revokedAt ? "revoked" : Date.parse(proof.expiresAt) <= Date.now() ? "expired" : proof.validity ?? "active",
    attestationStatus: proof.attestationStatus === "failed" ? "failed" : "attested",
    attestation: proof.attestation
      ? {
          attestationId: proof.attestation.attestationId ?? proof.attestation.quoteId ?? `legacy_${proof.proofId || proof.id}`,
          proofHash: proof.attestation.proofHash ?? proofHash(normalizedForHash),
          issuer: proof.attestation.issuer ?? proof.signature?.signer ?? "legacy-local-attestation",
          issuedAt: attestationIssuedAt,
          expiresAt: attestationExpiresAt,
          executionEnvironment:
            proof.attestation.executionEnvironment ??
            "Legacy local simulated confidential execution adapter",
          signature:
            proof.attestation.signature ??
            {
              scheme: "ed25519",
              signer: proof.signature?.signer ?? "legacy-local-attestation",
              value: "",
              message: "",
            },
          verificationStatus: proof.attestation.verificationStatus ?? "invalid_state",
          provider: proof.attestation.provider ?? "ProofRent local attestation adapter",
          quoteId: proof.attestation.quoteId,
          measurement: proof.attestation.measurement,
        }
      : undefined,
    shareUrlPath: proof.shareUrlPath ?? `/verify-proof/${proof.proofId || proof.id}`,
    selectiveDisclosure:
      proof.selectiveDisclosure ?? [
        "proofId",
        "tenantWallet",
        "compatibleRentRange",
        "riskCategory",
        "validity",
        "expiresAt",
        "attestationStatus",
      ],
  };
};

export const ensureSeedData = () => {
  const storedProperties = read<Property[]>(PROPERTY_KEY, []);
  const starterIds = starterProperties.map((property) => property.id).join(",");
  const storedIds = storedProperties.map((property) => property.id).join(",");
  const starterImages = starterProperties.map((property) => property.image).join(",");
  const storedImages = storedProperties.map((property) => property.image).join(",");
  if (!localStorage.getItem(PROPERTY_KEY) || storedIds !== starterIds || storedImages !== starterImages) {
    write(PROPERTY_KEY, starterProperties);
  }
  if (!localStorage.getItem(PROOF_KEY)) {
    write<Proof[]>(PROOF_KEY, []);
  }
  if (!localStorage.getItem(APPLICATION_KEY)) {
    write<Application[]>(APPLICATION_KEY, []);
  }
};

export const getProperties = () => read<Property[]>(PROPERTY_KEY, starterProperties);
export const saveProperties = (properties: Property[]) => write(PROPERTY_KEY, properties);

export const getProofs = () => read<Proof[]>(PROOF_KEY, []).map(normalizeProof);
export const saveProofs = (proofs: Proof[]) => write(PROOF_KEY, proofs);

export const getApplications = () => read<Application[]>(APPLICATION_KEY, []);
export const saveApplications = (applications: Application[]) =>
  write(APPLICATION_KEY, applications);

export const findProperty = (id?: string) => getProperties().find((property) => property.id === id);
export const findProof = (id?: string) =>
  getProofs().find((proof) => proof.id === id || proof.proofId === id);
export const findApplication = (id?: string) =>
  getApplications().find((application) => application.id === id);

export const isProofCompatibleWithRent = (proof: Proof, rent: number) =>
  proof.status === "Tenant Verified" &&
  proof.validity !== "revoked" &&
  Date.parse(proof.expiresAt) > Date.now() &&
  rent >= proof.compatibleRentRange.min &&
  rent <= proof.compatibleRentRange.max;

export const revokeStoredProof = (proofId: string, reason: string) => {
  const revokedAt = new Date().toISOString();
  const next = getProofs().map((proof) =>
    proof.id === proofId || proof.proofId === proofId
      ? {
          ...proof,
          validity: "revoked" as const,
          revokedAt,
          revocationReason: reason,
        }
      : proof,
  );
  saveProofs(next);
  return next.find((proof) => proof.id === proofId || proof.proofId === proofId);
};
