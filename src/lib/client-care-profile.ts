const CARE_PROFILE_PREFIX = "SALONSAAS_CARE_V1:";

export type ClientCareProfile = {
  notes: string;
  allergies: string;
  preferences: string;
  consentGiven: boolean;
};

const EMPTY_PROFILE: ClientCareProfile = {
  notes: "",
  allergies: "",
  preferences: "",
  consentGiven: false,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseClientCareProfile(value: string | null | undefined): ClientCareProfile {
  if (!value) return { ...EMPTY_PROFILE };
  if (!value.startsWith(CARE_PROFILE_PREFIX)) {
    return { ...EMPTY_PROFILE, notes: value };
  }

  try {
    const parsed = JSON.parse(value.slice(CARE_PROFILE_PREFIX.length)) as Record<string, unknown>;
    return {
      notes: text(parsed.notes),
      allergies: text(parsed.allergies),
      preferences: text(parsed.preferences),
      consentGiven: parsed.consentGiven === true,
    };
  } catch {
    return { ...EMPTY_PROFILE, notes: value };
  }
}

export function serializeClientCareProfile(profile: ClientCareProfile): string | null {
  const normalized = {
    notes: text(profile.notes),
    allergies: text(profile.allergies),
    preferences: text(profile.preferences),
    consentGiven: profile.consentGiven === true,
  };
  if ((normalized.allergies || normalized.preferences) && !normalized.consentGiven) {
    throw new Error("Registre o consentimento do cliente antes de salvar dados de cuidados.");
  }
  const hasContent = normalized.notes || normalized.allergies || normalized.preferences || normalized.consentGiven;
  return hasContent ? `${CARE_PROFILE_PREFIX}${JSON.stringify(normalized)}` : null;
}
