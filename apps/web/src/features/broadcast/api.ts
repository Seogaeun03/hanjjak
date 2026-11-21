export type BannerTone = "INFO" | "EVENT" | "WARNING";

export type Banner = {
  bannerId: string;
  message: string;
  tone: BannerTone;
  expiresAt: string;
};

export type BannerPage = { items: Banner[] };
export type BannerDismissResult = { bannerId: string; dismissedAt: string };

type Envelope<T> = { data: T };
type ErrorEnvelope = { code?: string; messageKey?: string };

export class BannerApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Envelope<T> & ErrorEnvelope;
  if (!response.ok) throw new BannerApiError(response.status, body.code || body.messageKey || `HTTP_${response.status}`);
  return body.data;
}

export const bannerApi = {
  list: () => fetch("/api/v1/banners", { credentials: "include", headers: { Accept: "application/json" } }).then(json<BannerPage>),
  /* 같은 배너를 두 번 닫아도 결과가 같다. 멱등 키까지 붙일 이유가 없다. */
  dismiss: (bannerId: string) => fetch(`/api/v1/banners/${bannerId}/dismiss`, {
    method: "POST", credentials: "include", headers: { Accept: "application/json" },
  }).then(json<BannerDismissResult>),
};
