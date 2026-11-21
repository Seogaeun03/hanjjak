export type SsafyRegion = "SEOUL" | "SEOUL_MEISTER" | "DAEJEON" | "GWANGJU" | "GUMI" | "BUSAN_ULSAN_GYEONGNAM" | "UNDETERMINED";
export type SsafyAffiliationRegionReason = "SINGLE_REGION" | "MULTIPLE_REGIONS" | "NO_REGION_GROUP" | "NO_SUPPORTED_GROUP";
export type SsafyAffiliationVerificationStatus = "VERIFIED" | "NO_SUPPORTED_GROUP" | "STALE" | "UNVERIFIED";
export type SsafyAffiliation = {
  currentCohort: number | null;
  cohortHistory: number[];
  multipleCohorts: boolean;
  region: SsafyRegion | null;
  regionReason: SsafyAffiliationRegionReason | null;
  verificationStatus: SsafyAffiliationVerificationStatus;
  lastAttemptedAt: string;
  lastVerifiedAt: string | null;
};
export type AccountIdentity = { accountId: string; characterId: string; email: string; nickname: string; level: number; experience: number; rice: number; nicknameChangeCost?: number; ssafyAffiliation?: SsafyAffiliation | null };
export type SessionState = { authenticated: boolean; account: AccountIdentity | null; administrator: boolean };
export type AuthenticationMethods = { emailEnabled: boolean };
export type Credentials = { email: string; password: string };
export type SignupCredentials = Credentials & { nickname: string };
export type NicknameUpdate = { nickname: string };
export type NicknameAvailability = { available: boolean };
export type PasswordResetRequest = { email: string };
export type PasswordResetConfirmation = { token: string; password: string };
export type PasswordResetAcknowledgement = { accepted: boolean };
export type PasswordChange = { currentPassword: string; newPassword: string; newPasswordConfirmation: string };
export type SocialProvider = { id: string; displayName: string; enabled: boolean };
export type SocialAuthorization = { authorizationUrl: string };
export type PendingSocialSignup = { token: string; provider: string; email: string | null; suggestedNickname: string | null };
export type SocialConnection = { provider: string; displayName: string; email: string | null };
export type SocialConnections = { passwordEnabled: boolean; providers: SocialConnection[] };
export type SocialSignup = { token: string; nickname: string };

type Envelope<T> = { data: T };
type ErrorDetail = { field?: string; code: string; messageKey: string; value?: unknown };
type ErrorEnvelope = { code?: string; messageKey?: string; details?: ErrorDetail[] | null };

export class AuthApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Envelope<T> & ErrorEnvelope;
  if (!response.ok) throw new AuthApiError(response.status, body.code || `HTTP ${response.status}`);
  return body.data;
}

function commandHeaders(): HeadersInit {
  return { "Accept": "application/json", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() };
}

export const adminGameAuthApi = {
  begin: () => fetch("/api/admin/v1/auth/game/gitlab/begin", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  }).then(json<SocialAuthorization>),
  session: () => fetch("/api/admin/v1/auth/game/session", {
    credentials: "include",
    headers: { Accept: "application/json" },
  }).then(json<{ administrator: boolean }>),
};

export const authApi = {
  methods: () => fetch("/api/v1/auth/methods", { credentials: "include", headers: { Accept: "application/json" } }).then(json<AuthenticationMethods>),
  socialProviders: () => fetch("/api/v1/auth/social/providers", { credentials: "include", headers: { Accept: "application/json" } }).then(json<SocialProvider[]>),
  beginSocial: (provider: string, link = false) => fetch(`/api/v1/auth/social/${encodeURIComponent(provider)}/${link ? "link/" : ""}begin`, {
    method: "POST",
    credentials: "include",
    headers: commandHeaders(),
    body: "{}",
  }).then(json<SocialAuthorization>),
  pendingSocialSignup: () => fetch("/api/v1/auth/social/pending", { credentials: "include", headers: { Accept: "application/json" } }).then(json<PendingSocialSignup>),
  finishSocialSignup: (request: SocialSignup) => fetch("/api/v1/auth/social/signup", {
    method: "POST",
    credentials: "include",
    headers: commandHeaders(),
    body: JSON.stringify(request),
  }).then(json<AccountIdentity>),
  socialConnections: () => fetch("/api/v1/auth/social/connections", { credentials: "include", headers: { Accept: "application/json" } }).then(json<SocialConnections>),
  unlinkSocial: (provider: string) => fetch(`/api/v1/auth/social/connections/${encodeURIComponent(provider)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json", "Idempotency-Key": crypto.randomUUID() },
  }).then(json<SocialConnections>),
  session: () => fetch("/api/v1/auth/session", { credentials: "include", headers: { Accept: "application/json" } }).then(json<SessionState>),
  nicknameAvailability: (nickname: string) => fetch(`/api/v1/auth/nickname-availability?nickname=${encodeURIComponent(nickname.trim())}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  }).then(json<NicknameAvailability>),
  signup: (credentials: SignupCredentials) => fetch("/api/v1/auth/signup", {
    method: "POST",
    credentials: "include",
    headers: commandHeaders(),
    body: JSON.stringify(credentials),
  }).then(json<AccountIdentity>),
  login: (credentials: Credentials) => fetch("/api/v1/auth/login", {
    method: "POST",
    credentials: "include",
    headers: commandHeaders(),
    body: JSON.stringify(credentials),
  }).then(json<AccountIdentity>),
  requestPasswordReset: (request: PasswordResetRequest) => fetch("/api/v1/auth/password-reset/request", {
    method: "POST",
    credentials: "include",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }).then(json<PasswordResetAcknowledgement>),
  confirmPasswordReset: (request: PasswordResetConfirmation) => fetch("/api/v1/auth/password-reset/confirm", {
    method: "POST",
    credentials: "include",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }).then(json<PasswordResetAcknowledgement>),
  updateNickname: (request: NicknameUpdate) => fetch("/api/v1/auth/profile/nickname", {
    method: "POST",
    credentials: "include",
    headers: commandHeaders(),
    body: JSON.stringify(request),
  }).then(json<AccountIdentity>),
  changePassword: (request: PasswordChange) => fetch("/api/v1/auth/profile/password", {
    method: "POST",
    credentials: "include",
    headers: commandHeaders(),
    body: JSON.stringify(request),
  }).then(json<SessionState>),
  logout: () => fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Idempotency-Key": crypto.randomUUID() },
  }).then(json<SessionState>),
  deleteAccount: () => fetch("/api/v1/auth/delete", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Idempotency-Key": crypto.randomUUID() },
  }).then(json<SessionState>),
};
