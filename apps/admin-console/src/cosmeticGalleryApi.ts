export type CosmeticReview = "pending" | "approved" | "rejected";
export type CosmeticJobStatus = "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed";
export type DraftFrame = {
  id: string;
  slot: string;
  motion: string;
  frame: number;
  url: string;
  review: CosmeticReview;
  revision: number;
  width: number;
  height: number;
};
export type DraftSet = {
  id: string;
  name: string;
  conceptUrl: string;
  status: CosmeticJobStatus;
  completedFrames: number;
  totalFrames: number;
  currentSlot: string | null;
  currentMotion: string | null;
  error: string | null;
  frames: DraftFrame[];
};

const STUDIO_PATH = "/api/admin/v1/cosmetics/studio";

export function cosmeticStudioError(code: string): string {
  return code === "COSMETIC_STUDIO_BYOK_NOT_CONFIGURED"
    ? "BYOK_API_URL 또는 BYOK_API_KEY 환경변수가 설정되지 않았거나 유효하지 않아 치장 생성을 진행할 수 없습니다. 운영 설정을 확인해 주세요. 백그라운드 생성 작업은 중단되었습니다."
    : code;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${STUDIO_PATH}${path}`, { ...init, credentials: "same-origin" });
  } catch (failure) {
    throw new Error(`치장 갤러리 서버에 연결할 수 없습니다: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" ? payload.code : null;
    const detail = code ? cosmeticStudioError(code)
      : payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message
        : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(code === "COSMETIC_STUDIO_BYOK_NOT_CONFIGURED" ? detail : `치장 갤러리 요청 실패: ${detail}`);
  }
  if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("치장 갤러리 응답 형식이 올바르지 않습니다.");
  return payload.data as T;
}

export const cosmeticGalleryApi = {
  list(signal?: AbortSignal): Promise<DraftSet[]> {
    return request<DraftSet[]>("/sets", { signal });
  },
  get(id: string, signal?: AbortSignal): Promise<DraftSet> {
    return request<DraftSet>(`/sets/${encodeURIComponent(id)}`, { signal });
  },
  create(name: string, concept: File): Promise<DraftSet> {
    const body = new FormData();
    body.append("name", name);
    body.append("concept", concept, concept.name);
    return request<DraftSet>("/sets", { method: "POST", body });
  },
  cancel(id: string): Promise<DraftSet> {
    return request<DraftSet>(`/sets/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  },
  review(id: string, frameId: string, review: CosmeticReview): Promise<DraftSet> {
    return request<DraftSet>(`/sets/${encodeURIComponent(id)}/frames/${encodeURIComponent(frameId)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review }),
    });
  },
  regenerate(id: string, frameId: string): Promise<DraftSet> {
    return request<DraftSet>(`/sets/${encodeURIComponent(id)}/frames/${encodeURIComponent(frameId)}/regenerate`, { method: "POST" });
  },
};

export function studioImageUrl(url: string): string {
  const parsed = new URL(url, window.location.href);
  if (parsed.origin !== window.location.origin || parsed.hash) throw new Error("이미지 주소가 같은 운영 서버를 가리키지 않습니다.");
  const pathname = parsed.pathname.startsWith(`${STUDIO_PATH}/`)
    ? parsed.pathname
    : parsed.pathname.startsWith("/sets/") ? `${STUDIO_PATH}${parsed.pathname}` : null;
  if (!pathname) throw new Error("이미지 주소가 치장 스튜디오 경로가 아닙니다.");
  return `${pathname}${parsed.search}`;
}

export async function fetchDraftImage(url: string): Promise<Blob> {
  const imageUrl = new URL(studioImageUrl(url), window.location.href);
  let response: Response;
  try {
    response = await fetch(imageUrl.href, { credentials: "same-origin" });
  } catch (failure) {
    throw new Error(`프레임 이미지를 가져오지 못했습니다: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  if (!response.ok) throw new Error(`프레임 이미지를 가져오지 못했습니다: HTTP ${response.status}`);
  return response.blob();
}
