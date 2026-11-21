import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ImgHTMLAttributes } from "react";
import { downloadWebpZip, encodeWebp, exportGameFrames, gameFrames, type GameFrame } from "./cosmeticFrameAssets";
import { cosmeticGalleryApi, cosmeticStudioError, fetchDraftImage, type CosmeticReview, type DraftFrame, type DraftSet } from "./cosmeticGalleryApi";
import cosmeticCatalog from "../../../packages/game-content/versions/v1/cosmetics/cosmetics.json";
import cosmeticIdentities from "../../../packages/game-content/catalogs/cosmetic-identities.json";
import angelManifest from "../../web/public/assets/characters/angel/runtime-equipment-v1/angel-equipment-manifest.json";
import yakgwaManifest from "../../web/public/assets/characters/yakgwa/runtime-equipment-v1/yakgwa-equipment-manifest.json";
import "./CosmeticManagementView.css";

type RuntimeManifest = { drawOrderByFrame: Record<string, string[]> };
type CatalogCosmetic = (typeof cosmeticCatalog.cosmetics)[number];
type CatalogSet = { id: string; key: string; name: string; grade: string; items: CatalogCosmetic[] };
type GroupOption = { value: string; collection: string; group: string; label: string };

const SLOT_NAMES: Record<string, string> = { HEAD: "모자", TOP: "상의", BOTTOM: "무기", GLOVES: "장갑", SHOES: "신발", CAPE: "망토", FACE: "얼굴" };
const MOTION_NAMES: Record<string, string> = { rest: "대기", run: "달리기", run2: "달리기", strike1: "기본 공격", strike2: "추가 공격", thrust1: "찌르기", death: "쓰러짐", death1: "쓰러짐" };
const GRADE_NAMES: Record<string, string> = { NORMAL: "일반", RARE: "희귀", EPIC: "영웅", LEGENDARY: "전설" };
const LAYER_ORDER = ["back", "cape", "cape-back", "shoes", "shoe-left", "shoe-right", "shoe-01", "shoe-02", "body", "clothing", "clothing-01", "clothing-02", "clothing-03", "hat", "face", "weapon", "weapon-back", "weapon-01", "weapon-02", "weapon-03", "weapon-front", "arms", "base-arms", "sleeves", "gloves", "glove-left", "glove-right", "glove-back", "glove-palm", "base-body", "base-feet-front", "base-hands"];
const ART_GROUPS: Record<string, string[]> = { climbing: ["climbing-blue", "climbing-red"] };
const ART_MOTIONS: Record<string, string> = { run2: "run", death1: "death", thrust1: "strike2" };
const STRIKE2_FALLBACK_SETS = new Set(["cardboard-crayon", "white-fox-spirit", "dokkaebi", "magical-girl", "snake-water-guardian", "lightning-laurel", "forest-spirit", "royal-knight", "king", "grim-reaper", "cheerleader", "leaf", "meat-skewer"]);
const RUNTIME_VARIANTS: Record<string, string> = {
  "angel:cape": "angel-wings", "angel:clothing": "angel-white-robe",
  "angel:glove-left": "angel-wrist-rings · screen-left", "angel:glove-right": "angel-wrist-rings · screen-right",
  "angel:hat": "angel-halo", "angel:shoe-left": "angel-ankle-rings · screen-left", "angel:shoe-right": "angel-ankle-rings · screen-right",
  "angel:weapon-01": "angel-feather-sword", "angel:weapon-02": "angel-halo-staff", "angel:weapon-03": "angel-light-spear",
  "yakgwa:cape-back": "moonlit-yakgwa-cape · back", "yakgwa:clothing-01": "moonlit-yakgwa-clothing · part-01",
  "yakgwa:clothing-02": "moonlit-yakgwa-clothing · part-02", "yakgwa:clothing-03": "moonlit-yakgwa-clothing · part-03",
  "yakgwa:glove-back": "moonlit-yakgwa-glove · other-hand", "yakgwa:glove-palm": "moonlit-yakgwa-glove · weapon-hand",
  "yakgwa:hat": "moonlit-yakgwa-hat", "yakgwa:shoe-01": "moonlit-yakgwa-shoe · part-01", "yakgwa:shoe-02": "moonlit-yakgwa-shoe · part-02",
  "yakgwa:weapon-back": "moonlit-yakgwa-weapon · back", "yakgwa:weapon-front": "moonlit-yakgwa-weapon · front",
};
const BODY_GROUPS: Record<string, string[]> = {
  HEAD: ["hat"], TOP: ["body", "sleeves", "clothing", "clothing-01", "clothing-02", "clothing-03", "base-body"],
  BOTTOM: ["weapon", "weapon-back", "weapon-01", "weapon-02", "weapon-03", "weapon-front"],
  GLOVES: ["gloves", "glove-left", "glove-right", "glove-back", "glove-palm", "base-arms", "base-hands"],
  SHOES: ["shoes", "shoe-left", "shoe-right", "shoe-01", "shoe-02", "base-feet-front"],
  CAPE: ["back", "cape", "cape-back"], BASE: ["arms", "base-arms", "base-body", "base-feet-front", "base-hands", "body"],
};
const RUNTIME_MANIFESTS: Record<string, RuntimeManifest> = { angel: angelManifest, yakgwa: yakgwaManifest };
const canonicalSets: CatalogSet[] = cosmeticIdentities.sets.map((identity) => {
  const items = cosmeticCatalog.cosmetics.filter((item) => item.setId === identity.setId);
  const firstName = items[0]?.displayName ?? identity.key.slice("set:".length);
  return { id: identity.setId, key: identity.key.slice("set:".length), name: firstName.replace(/\s+(모자|상의|무기|장갑|신발|망토)$/u, ""), grade: identity.grade, items };
});

const availableGroups = new Map<string, GroupOption>();
for (const frame of gameFrames) {
  const value = `${frame.collection}:${frame.group}`;
  if (!availableGroups.has(value)) {
    const runtimeLabel = RUNTIME_VARIANTS[`${frame.collection}:${frame.group}`];
    availableGroups.set(value, { value, collection: frame.collection, group: frame.group, label: runtimeLabel ? `${frame.collection} 런타임 · ${runtimeLabel}` : frame.collection === "game-motion" ? `게임 아트 · ${frame.group}` : `${frame.collection} 런타임 · ${frame.group}` });
  }
}

function urlSetId(): string | null { return new URLSearchParams(window.location.search).get("cosmetic"); }
function writeUrlSetId(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("cosmetic", id); else url.searchParams.delete("cosmetic");
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
function DraftWebpImage({ url, ...props }: ImgHTMLAttributes<HTMLImageElement> & { url: string }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSrc(undefined); setError(undefined);
    void fetchDraftImage(url).then((blob) => encodeWebp(blob, url)).then((blob) => {
      if (active) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); }
    }).catch((failure) => { if (active) setError(messageOf(failure, "이미지를 표시하지 못했습니다.")); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return error ? <span role="alert">{error}</span> : <img {...props} src={src} />;
}

export function CosmeticManagementView() {
  const [drafts, setDrafts] = useState<DraftSet[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(urlSetId);
  const [selectedDraft, setSelectedDraft] = useState<DraftSet | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [name, setName] = useState("");
  const [concept, setConcept] = useState<File | null>(null);
  const [conceptPreview, setConceptPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mutation, setMutation] = useState<string | null>(null);
  const listBusy = useRef(false);
  const listVersion = useRef(0);
  const selectedRef = useRef(selectedId);
  const detailVersion = useRef(0);
  const [catalogGroup, setCatalogGroup] = useState("");
  const [catalogMotion, setCatalogMotion] = useState("rest");
  const [catalogBodyGroup, setCatalogBodyGroup] = useState("all");
  const [catalogFrame, setCatalogFrame] = useState(1);
  const [draftSlot, setDraftSlot] = useState("HEAD");
  const [draftMotion, setDraftMotion] = useState("rest");
  const [draftFrameId, setDraftFrameId] = useState<string | null>(null);

  const activeJobs = drafts.some((draft) => draft.status === "queued" || draft.status === "running" || draft.status === "cancelling");
  const canonicalById = useMemo(() => new Map(canonicalSets.map((set) => [set.id, set])), []);
  const selectedCanonical = selectedId ? canonicalById.get(selectedId) ?? null : null;
  const selectedDraftId = selectedId && !selectedCanonical ? selectedId : null;
  const loadDrafts = useCallback(async (manual = false) => {
    if (listBusy.current) return;
    listBusy.current = true;
    if (manual) setIsRefreshing(true);
    const version = listVersion.current;
    try {
      const next = await cosmeticGalleryApi.list();
      if (version !== listVersion.current) return;
      setDrafts(next); setListError(null);
      const currentId = selectedRef.current;
      const current = currentId ? next.find((draft) => draft.id === currentId) : null;
      if (current) setSelectedDraft((existing) => existing?.id === current.id ? mergeDraftProgress(existing, current) : existing);
    } catch (failure) {
      if (version === listVersion.current) setListError(messageOf(failure, "치장 초안을 불러오지 못했습니다."));
    } finally {
      listBusy.current = false;
      if (manual) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);
  useEffect(() => {
    if (document.visibilityState === "hidden") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadDrafts(); }, activeJobs ? 2000 : 15000);
    return () => window.clearInterval(timer);
  }, [activeJobs, loadDrafts]);
  useEffect(() => {
    const onPopState = () => { const next = urlSetId(); selectedRef.current = next; setSelectedId(next); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (!concept) { setConceptPreview(null); return; }
    const url = URL.createObjectURL(concept); setConceptPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [concept]);
  useEffect(() => () => { detailVersion.current += 1; listVersion.current += 1; }, []);
  useEffect(() => {
    if (!selectedDraftId) { setSelectedDraft(null); setDetailError(null); return; }
    const requestedId = selectedDraftId;
    const version = ++detailVersion.current;
    const controller = new AbortController();
    setSelectedDraft(null); setDetailError(null);
    cosmeticGalleryApi.get(requestedId, controller.signal).then((draft) => {
      if (!controller.signal.aborted && version === detailVersion.current && selectedRef.current === requestedId) setSelectedDraft(draft);
    }).catch((failure) => {
      if (!controller.signal.aborted && version === detailVersion.current && selectedRef.current === requestedId) setDetailError(messageOf(failure, "초안 정보를 불러오지 못했습니다."));
    });
    return () => controller.abort();
  }, [selectedDraftId]);

  function selectSet(id: string | null): void {
    selectedRef.current = id; setSelectedId(id); detailVersion.current += 1;
    writeUrlSetId(id); setDetailError(null); setActionError(null);
    setSelectedDraft(id && !canonicalById.has(id) ? drafts.find((item) => item.id === id) ?? null : null);
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!concept || !name.trim() || creating) return;
    setCreating(true); setActionError(null); listVersion.current += 1;
    try {
      const created = await cosmeticGalleryApi.create(name.trim(), concept);
      setDrafts((current) => [created, ...current.filter((draft) => draft.id !== created.id)]);
      setName(""); setConcept(null); setCreateOpen(false); selectSet(created.id);
    } catch (failure) { setActionError(messageOf(failure, "치장 작업을 만들지 못했습니다.")); }
    finally { setCreating(false); }
  }
  function updateDraft(next: DraftSet, fromAction = false): void {
    setDrafts((current) => [next, ...current.filter((draft) => draft.id !== next.id)]);
    if (fromAction && selectedRef.current === next.id) setSelectedDraft(next);
  }
  async function mutateDraft(key: string, action: () => Promise<DraftSet>): Promise<void> {
    if (!selectedDraftId || mutation) return;
    const targetId = selectedDraftId;
    detailVersion.current += 1; listVersion.current += 1; setMutation(key); setActionError(null);
    try { updateDraft(await action(), true); }
    catch (failure) { setActionError(messageOf(failure, "초안을 변경하지 못했습니다.")); }
    finally { setMutation(null); }
    if (selectedRef.current !== targetId) return;
  }
  async function regenerateRejected(draft: DraftSet): Promise<void> {
    const rejected = draft.frames.filter((frame) => frame.review === "rejected");
    if (mutation || !rejected.length) return;
    setMutation(`regenerate-rejected:${draft.id}`); setActionError(null);
    listVersion.current += 1; detailVersion.current += 1;
    let completed = 0;
    try {
      for (const frame of rejected) {
        updateDraft(await cosmeticGalleryApi.regenerate(draft.id, frame.id), true);
        completed += 1;
      }
    } catch (failure) {
      setActionError(`${completed} / ${rejected.length}개 재생성 완료. ${messageOf(failure, "남은 거부 프레임을 재생성하지 못했습니다.")}`);
    } finally { setMutation(null); }
  }
  async function exportCatalogFrames(set: CatalogSet, selection: GameFrame[]): Promise<void> {
    if (!selection.length || mutation) return;
    setMutation(`export:${set.id}`); setActionError(null);
    try {
      const groupKey = catalogGroup || groupOptions(set)[0]?.value || "";
      const suffix = [groupKey.split(":")[1], catalogMotion, catalogBodyGroup === "all" ? "all-parts" : catalogBodyGroup].filter(Boolean).join("-");
      await exportGameFrames(selection, `${set.key}-${suffix}.zip`);
    } catch (failure) { setActionError(messageOf(failure, "게임 프레임 ZIP을 내보내지 못했습니다.")); }
    finally { setMutation(null); }
  }
  async function exportApproved(draft: DraftSet): Promise<void> {
    const approved = draft.frames.filter((frame) => frame.review === "approved");
    if (draft.status !== "completed" || !approved.length || mutation) return;
    setMutation(`export:${draft.id}`); setActionError(null);
    try {
      const entries = await Promise.all(approved.map(async (frame) => ({ path: `${frame.slot}/${frame.motion}_${String(frame.frame).padStart(2, "0")}.webp`, blob: await fetchDraftImage(frame.url) })));
      await downloadWebpZip(entries, `${draft.name}-approved.zip`);
    } catch (failure) { setActionError(messageOf(failure, "승인 프레임 ZIP을 내보내지 못했습니다.")); }
    finally { setMutation(null); }
  }

  const allRows = useMemo(() => [
    ...canonicalSets.map((set) => ({ type: "catalog" as const, id: set.id, name: set.name, set })),
    ...drafts.map((draft) => ({ type: "draft" as const, id: draft.id, name: draft.name, draft })),
  ], [drafts]);
  return <div className="content cosmetic-gallery-content">
    <section className="overview-head cosmetic-gallery-heading"><div><p>기준 치장 세트 28종과 서버에서 제작 중인 초안을 한곳에서 살펴봅니다.</p><span>세트를 골라 프레임을 확인하고 필요한 자료를 내보낼 수 있습니다.</span></div><button className="secondary" type="button" onClick={() => void loadDrafts(true)} disabled={isRefreshing}>{isRefreshing ? "불러오는 중…" : "↻ 새로고침"}</button></section>
    {(listError || detailError || actionError) && <div className="alert error" role="alert">{actionError ?? detailError ?? listError}</div>}
    {jobsOpen && <article className="panel cosmetic-jobs-panel" aria-label="제작 작업 목록">
      <header className="panel-title"><div><h2>작업 목록</h2><p>여러 세트의 생성 작업을 등록할 수 있습니다. 작업은 서버에서 계속 진행됩니다.</p></div><div className="cosmetic-detail-header-actions"><button className="primary" type="button" onClick={() => setCreateOpen(true)}>치장 세트 추가</button><button className="secondary" type="button" onClick={() => setJobsOpen(false)}>닫기</button></div></header>
      {!drafts.length && <p>등록된 제작 작업이 없습니다.</p>}
      <div className="cosmetic-jobs-list">{[...drafts].sort((a, b) => Number(!["queued", "running", "cancelling"].includes(a.status)) - Number(!["queued", "running", "cancelling"].includes(b.status))).map((draft) => {
        const approved = draft.frames.filter((frame) => frame.review === "approved").length;
        const rejected = draft.frames.filter((frame) => frame.review === "rejected").length;
        const reviewed = approved + rejected;
        const active = ["queued", "running", "cancelling"].includes(draft.status);
        const reviewComplete = draft.completedFrames > 0 && reviewed === draft.completedFrames;
        const stage = active ? "generation" : draft.status === "failed" || draft.status === "cancelled" ? "stopped" : "review";
        const stageLabel = active ? `생성 · ${statusLabel(draft.status)}` : stage === "stopped" ? statusLabel(draft.status) : !reviewComplete ? "검수 중" : rejected ? "검수 완료 · 수정 필요" : "검수 완료";
        return <button className="cosmetic-job-row" type="button" key={draft.id} onClick={() => { selectSet(draft.id); setJobsOpen(false); }}>
          <div className="cosmetic-job-heading"><strong>{draft.name}</strong><span className={`cosmetic-job-stage ${active ? "generation" : stage}`}>{stageLabel}</span></div>
          <span>생성 진행도 · {draft.completedFrames} / {draft.totalFrames} 프레임 · {Math.round(draft.completedFrames / draft.totalFrames * 100)}%</span>
          <progress className="cosmetic-generation-progress" value={draft.completedFrames} max={draft.totalFrames} aria-label={`${draft.name} 생성 진행도`} />
          <span>검수 진행도 · {reviewed} / {draft.completedFrames} 프레임{draft.completedFrames ? ` · ${Math.round(reviewed / draft.completedFrames * 100)}%` : " · 생성 대기"}</span>
          <progress className="cosmetic-review-progress" value={reviewed} max={Math.max(1, draft.completedFrames)} aria-label={`${draft.name} 검수 진행도`} />
          <small>승인 {approved} · 거부 {rejected} · 검수 대기 {draft.completedFrames - reviewed}</small>
          <small>{draft.currentSlot ? `${SLOT_NAMES[draft.currentSlot]} · ${MOTION_NAMES[draft.currentMotion ?? ""] ?? ""}` : "프레임 확인·검수 열기"}</small>
        </button>;
      })}</div>
    </article>}
    <section className="cosmetic-gallery-layout">
      <div className="cosmetic-gallery-list-column">
        {createOpen && <article className="panel cosmetic-create-panel"><header className="panel-title"><div><h2>치장 세트 추가</h2><p>이름과 컨셉 이미지를 등록해 서버 작업을 시작합니다.</p></div><button className="secondary" type="button" disabled={creating} onClick={() => { setCreateOpen(false); setName(""); setConcept(null); }}>취소</button></header>
          <form className="cosmetic-create-form" onSubmit={(event) => void submit(event)}>
            <label>세트 이름<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required placeholder="예: 새벽 정원 수호자" disabled={creating} /></label>
            <label>컨셉 이미지 · PNG/JPEG<input type="file" accept="image/png,image/jpeg" onChange={(event) => setConcept(event.target.files?.[0] ?? null)} required disabled={creating} /></label>
            <small className="cosmetic-upload-help">PNG 또는 JPEG 이미지를 선택해 주세요. WebP는 지원하지 않습니다.</small>
            {conceptPreview && <img className="cosmetic-concept-preview" src={conceptPreview} alt="선택한 컨셉" />}
            <button className="primary" type="submit" disabled={creating || !name.trim() || !concept}>{creating ? "작업 등록 중…" : "프레임 생성 작업 시작"}</button>
          </form></article>}
        <article className="panel cosmetic-catalog-panel"><header className="panel-title"><div><h2>세트 갤러리</h2><p>{canonicalSets.length}개 기준 세트 · {drafts.length}개 초안</p></div><button className="primary cosmetic-add-set" type="button" onClick={() => setCreateOpen(true)}>치장 세트 추가</button></header>
          {listError && drafts.length === 0 && <div className="cosmetic-list-error"><span>{listError}</span><button className="secondary" type="button" onClick={() => void loadDrafts(true)}>다시 시도</button></div>}
          <div className="cosmetic-gallery-list">{allRows.map((row) => row.type === "catalog" ? <CatalogCard key={row.id} set={row.set} selected={selectedId === row.id} onSelect={() => selectSet(row.id)} /> : <DraftCard key={row.id} draft={row.draft} selected={selectedId === row.id} onSelect={() => selectSet(row.id)} />)}</div>
        </article>
      </div>
      <section className="panel cosmetic-gallery-detail" aria-live="polite">
        {!selectedId && <div className="cosmetic-detail-empty"><span>✧</span><h2>세트를 선택하세요</h2><p>기준 세트 또는 제작 초안을 선택하면 상세 프레임을 확인할 수 있습니다.</p></div>}
        {selectedCanonical && <CatalogDetail set={selectedCanonical} group={catalogGroup} onGroupChange={(value) => { setCatalogGroup(value); setCatalogBodyGroup("all"); setCatalogFrame(1); }} motion={catalogMotion} onMotionChange={(value) => { setCatalogMotion(value); setCatalogFrame(1); }} bodyGroup={catalogBodyGroup} onBodyGroupChange={(value) => { setCatalogBodyGroup(value); setCatalogFrame(1); }} frame={catalogFrame} onFrameChange={setCatalogFrame} busy={mutation === `export:${selectedCanonical.id}`} onExport={(frames) => void exportCatalogFrames(selectedCanonical, frames)} openJobs={() => { setJobsOpen(true); void loadDrafts(true); }} clearSelection={() => selectSet(null)} />}
        {selectedDraftId && !selectedDraft && !detailError && <div className="cosmetic-detail-empty"><div className="loader" /><p>초안 상세 정보를 불러오는 중입니다.</p></div>}
        {selectedDraft && selectedDraft.id === selectedDraftId && <DraftDetail draft={selectedDraft} slot={draftSlot} onSlotChange={(value) => { setDraftSlot(value); setDraftFrameId(null); }} motion={draftMotion} onMotionChange={(value) => { setDraftMotion(value); setDraftFrameId(null); }} selectedFrameId={draftFrameId} onFrameSelect={setDraftFrameId} busy={Boolean(mutation)} mutation={mutation} onCancel={() => void mutateDraft(`cancel:${selectedDraft.id}`, () => cosmeticGalleryApi.cancel(selectedDraft.id))} onReview={(frame, review) => void mutateDraft(`review:${frame.id}`, () => cosmeticGalleryApi.review(selectedDraft.id, frame.id, review))} onRegenerate={(frame) => void mutateDraft(`regenerate:${frame.id}`, () => cosmeticGalleryApi.regenerate(selectedDraft.id, frame.id))} openJobs={() => { setJobsOpen(true); void loadDrafts(true); }} clearSelection={() => selectSet(null)} onRegenerateRejected={() => void regenerateRejected(selectedDraft)} onExport={() => void exportApproved(selectedDraft)} />}
      </section>
    </section>
  </div>;
}

function CatalogCard({ set, selected, onSelect }: { set: CatalogSet; selected: boolean; onSelect: () => void }) {
  const groups = groupOptions(set);
  const featuredGroup = groups.find((option) => option.collection === "game-motion" && option.group === "climbing-blue") ?? groups.find((option) => option.collection === "game-motion") ?? groups[0];
  const preview = featuredGroup ? gameFrames.filter((frame) => frame.collection === featuredGroup.collection && frame.group === featuredGroup.group && frame.motion === "rest" && frame.frame === 1) : [];
  const preferred = [...preview].sort((a, b) => layerRank(a.layer) - layerRank(b.layer)).slice(0, 4);
  return <button className={selected ? "cosmetic-gallery-card selected" : "cosmetic-gallery-card"} type="button" aria-pressed={selected} onClick={onSelect}><span className="cosmetic-gallery-card-picture">{preferred.length ? <FrameStack frames={preferred} label={`${set.name} 프레임`} /> : <span className="cosmetic-gallery-no-art">이미지 없음</span>}</span><span className="cosmetic-gallery-card-copy"><strong>{set.name}</strong><small>{GRADE_NAMES[set.grade] ?? set.grade} · {set.items.length}개 아이템</small></span><span className="cosmetic-gallery-kind">기준 세트</span></button>;
}
function DraftCard({ draft, selected, onSelect }: { draft: DraftSet; selected: boolean; onSelect: () => void }) {
  const progress = draft.totalFrames > 0 ? Math.min(100, Math.round(draft.completedFrames / draft.totalFrames * 100)) : 0;
  return <button className={selected ? "cosmetic-gallery-card draft selected" : "cosmetic-gallery-card draft"} type="button" aria-pressed={selected} onClick={onSelect}><span className="cosmetic-gallery-card-picture">{draft.conceptUrl ? <DraftWebpImage url={draft.conceptUrl} alt="" loading="lazy" /> : <span className="cosmetic-gallery-no-art">컨셉 이미지 없음</span>}</span><span className="cosmetic-gallery-card-copy"><strong>{draft.name}</strong><small>{statusLabel(draft.status)} · {draft.completedFrames} / {draft.totalFrames} 프레임</small><span className="cosmetic-progress-track"><i style={{ width: `${progress}%` }} /></span></span><span className="cosmetic-gallery-kind draft">초안</span></button>;
}

function CatalogDetail({ set, group, onGroupChange, motion, onMotionChange, bodyGroup, onBodyGroupChange, frame, onFrameChange, openJobs, clearSelection, busy, onExport }: { set: CatalogSet; group: string; onGroupChange: (value: string) => void; motion: string; onMotionChange: (value: string) => void; bodyGroup: string; onBodyGroupChange: (value: string) => void; frame: number; onFrameChange: (value: number) => void; openJobs: () => void; clearSelection: () => void; busy: boolean; onExport: (frames: GameFrame[]) => void }) {
  const [runtimeVariant, setRuntimeVariant] = useState("");
  const groups = groupOptions(set);
  const selectedGroup = groups.some((option) => option.value === group) ? group : groups[0]?.value ?? "";
  const option = groups.find((item) => item.value === selectedGroup);
  const runtime = option?.collection === "angel" || option?.collection === "yakgwa";
  const variants = option?.collection === "angel" ? ["weapon-01", "weapon-02", "weapon-03"] : option?.collection === "yakgwa" ? ["all-weapons", "weapon-back", "weapon-front"] : [];
  const selectedVariant = variants.includes(runtimeVariant) ? runtimeVariant : variants[0] ?? "";
  const sourceFrames = option ? gameFrames.filter((item) => item.collection === option.collection && (runtime || item.group === option.group)) : [];
  const motions = [...new Set(sourceFrames.map((item) => item.motion))].sort((a, b) => motionOrder(a) - motionOrder(b) || a.localeCompare(b));
  const selectedMotion = motions.includes(motion) ? motion : motions.includes("rest") ? "rest" : motions[0] ?? "";
  const artMotion = ART_MOTIONS[selectedMotion] ?? selectedMotion;
  const fallbackMotion = artMotion === "strike2" && STRIKE2_FALLBACK_SETS.has(option?.group ?? "") ? "strike1" : artMotion;
  const motionFrames = sourceFrames.filter((item) => item.motion === fallbackMotion);
  const availableBodyGroups = [...new Set(motionFrames.map((item) => bodyGroupForLayer(item.layer)))].sort((a, b) => bodyGroupOrder(a) - bodyGroupOrder(b));
  const selectedBodyGroup = bodyGroup === "all" || availableBodyGroups.includes(bodyGroup) ? bodyGroup : "all";
  const expected = runtime || selectedMotion !== "death" ? [1, 2, 3, 4] : [1];
  const manifest = runtime ? RUNTIME_MANIFESTS[option.collection] : null;
  const isLayerSelected = (layer: string): boolean => {
    if (selectedBodyGroup !== "all" && bodyGroupForLayer(layer) !== selectedBodyGroup) return false;
    if (option?.collection === "angel" && layer.startsWith("weapon-") && layer !== selectedVariant) return false;
    if (option?.collection === "yakgwa" && layer.startsWith("weapon-") && selectedVariant !== "all-weapons" && layer !== selectedVariant) return false;
    return true;
  };
  const orderedFramesFor = (number: number): GameFrame[] => {
    if (!manifest) return motionFrames.filter((item) => item.frame === number && isLayerSelected(item.layer)).sort((a, b) => layerRank(a.layer) - layerRank(b.layer));
    const order = manifest.drawOrderByFrame[`${selectedMotion}_${String(number).padStart(2, "0")}`] ?? [];
    return order.flatMap((token) => {
      const [kind, slot, sublayer] = token.split(".");
      const layer = kind === "base" ? `base-${slot}` : slot === "glove" ? `glove-${sublayer === "screen-left" ? "left" : sublayer === "screen-right" ? "right" : sublayer === "weapon-hand" ? "palm" : "back"}` : slot === "shoe" ? `shoe-${sublayer === "screen-left" ? "left" : sublayer === "screen-right" ? "right" : sublayer?.replace("part-", "")}` : slot === "weapon" ? (option?.collection === "angel" ? selectedVariant : `weapon-${sublayer ?? "front"}`) : slot === "clothing" ? (sublayer ? `clothing-${sublayer.replace("part-", "")}` : "clothing") : slot === "cape" ? (sublayer ? `cape-${sublayer}` : "cape") : slot;
      if (!isLayerSelected(layer)) return [];
      const candidates = motionFrames.filter((item) => item.group === layer && item.frame === number);
      const layerFrame = candidates.find((item) => item.motion === artMotion) ?? candidates[0];
      return layerFrame ? [layerFrame] : [];
    });
  };
  const bodyFrames = expected.flatMap(orderedFramesFor);
  const frameCards = expected.map((number) => ({ number, frames: orderedFramesFor(number) }));
  const selectedNumber = expected.includes(frame) ? frame : expected[0] ?? 1;
  const selected = frameCards.find((item) => item.number === selectedNumber)?.frames ?? [];
  const tokens = manifest?.drawOrderByFrame[`${selectedMotion}_${String(selectedNumber).padStart(2, "0")}`] ?? [];
  const coverage = manifest && tokens.length ? `${selected.length} / ${tokens.length} 레이어` : `${selected.length}개 레이어`;
  const sheets = [...new Map(bodyFrames.filter((item) => item.crop).map((item) => [`${item.group}:${item.url}`, item])).values()];
  const itemNames = set.items.map((item) => `${SLOT_NAMES[item.slot] ?? item.slot}: ${item.displayName}`);
  return <div className="cosmetic-detail-body">
    <header className="cosmetic-detail-header"><div><span className="cosmetic-detail-eyebrow">기준 세트 · {set.id}</span><h2>{set.name}</h2><p>{GRADE_NAMES[set.grade] ?? set.grade} 등급 · 아이템 {set.items.length}개</p></div><div className="cosmetic-detail-header-actions"><button type="button" className="secondary" onClick={clearSelection}>갤러리 목록</button><button type="button" className="secondary" onClick={openJobs}>작업 목록</button></div></header>
    <p className="cosmetic-set-items">{itemNames.join("　·　")}</p>
    <div className="cosmetic-detail-filters"><label>아트 그룹<select aria-label="아트 그룹" value={selectedGroup} onChange={(event) => { setRuntimeVariant(""); onGroupChange(event.target.value); }}>{groups.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>동작<select aria-label="동작" value={selectedMotion} onChange={(event) => onMotionChange(event.target.value)}>{motions.map((item) => <option key={item} value={item}>{MOTION_NAMES[item] ?? item}</option>)}</select></label><label>부위 그룹<select aria-label="부위 그룹" value={selectedBodyGroup} onChange={(event) => onBodyGroupChange(event.target.value)}><option value="all">전체 부위 및 하위 레이어</option>{availableBodyGroups.map((item) => <option key={item} value={item}>{BODY_GROUP_NAMES[item] ?? item}</option>)}</select></label>{runtime && <label>무기 변형<select aria-label="무기 변형" value={selectedVariant} onChange={(event) => setRuntimeVariant(event.target.value)}>{variants.map((item) => <option key={item} value={item}>{item === "all-weapons" ? "앞·뒤 전체" : RUNTIME_VARIANTS[`${option.collection}:${item}`] ?? item}</option>)}</select></label>}</div>
    <section className="cosmetic-sheet-section"><div className="cosmetic-section-heading"><div><h3>{runtime ? "전체 런타임 모션 시트" : "프레임 스트립"}</h3><p>{option?.label ?? option?.group ?? "아트 없음"} · {MOTION_NAMES[selectedMotion] ?? selectedMotion}</p></div><span>{bodyFrames.length}개 프레임 파일</span></div>
      {sheets.length > 0 && <div className="cosmetic-runtime-sheet-grid">{sheets.map((item) => <figure key={`${item.group}:${item.url}`}><figcaption>{RUNTIME_VARIANTS[`${item.collection}:${item.group}`] ?? item.group}</figcaption><img src={item.url} alt={`${item.group} ${selectedMotion} 모션 시트`} loading="lazy" /></figure>)}</div>}
      <div className="cosmetic-frame-strip" role="list" aria-label="모션 프레임 스트립">{frameCards.map((card) => <button key={card.number} type="button" role="listitem" className={selectedNumber === card.number ? "cosmetic-strip-frame selected" : "cosmetic-strip-frame"} onClick={() => onFrameChange(card.number)} aria-label={`${card.number}프레임${card.frames.length ? "" : " (누락)"}`}><span className="cosmetic-frame-stack-wrap">{card.frames.length ? <FrameStack frames={card.frames} label={`${set.name} ${MOTION_NAMES[selectedMotion] ?? selectedMotion} ${card.number}프레임`} preserveOrder={runtime} /> : <span className="cosmetic-missing-frame">프레임 누락</span>}</span><strong>{String(card.number).padStart(2, "0")}</strong></button>)}</div>
    </section>
    <section className="cosmetic-enlarged-frame"><div className="cosmetic-section-heading"><div><h3>선택 프레임 확대</h3><p>{MOTION_NAMES[selectedMotion] ?? selectedMotion} {selectedNumber}프레임 · {coverage}</p></div><button className="primary" type="button" disabled={busy || !bodyFrames.length} onClick={() => onExport(bodyFrames)}>{busy ? "ZIP 준비 중…" : `선택 모션 ZIP 내보내기 (${bodyFrames.length}개)`}</button></div><div className="cosmetic-enlarged-canvas">{selected.length ? <FrameStack frames={selected} label={`${set.name} ${MOTION_NAMES[selectedMotion] ?? selectedMotion} ${selectedNumber}프레임 확대`} preserveOrder={runtime} /> : <span className="cosmetic-missing-frame">선택 조건에 해당하는 프레임이 없습니다.</span>}</div></section>
  </div>;
}

function DraftDetail({ draft, slot, onSlotChange, motion, onMotionChange, selectedFrameId, onFrameSelect, busy, mutation, openJobs, clearSelection, onCancel, onReview, onRegenerateRejected, onRegenerate, onExport }: { draft: DraftSet; slot: string; onSlotChange: (value: string) => void; motion: string; onMotionChange: (value: string) => void; selectedFrameId: string | null; onFrameSelect: (id: string | null) => void; busy: boolean; mutation: string | null; openJobs: () => void; clearSelection: () => void; onCancel: () => void; onReview: (frame: DraftFrame, review: CosmeticReview) => void; onRegenerate: (frame: DraftFrame) => void; onRegenerateRejected: () => void; onExport: () => void }) {
  const slots = ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE"];
  const selectedSlot = slots.includes(slot) ? slot : "HEAD";
  const slotFrames = draft.frames.filter((frame) => frame.slot === selectedSlot);
  const motions = ["rest", "run", "strike1", "strike2", "death"];
  const selectedMotion = motions.includes(motion) ? motion : "rest";
  const frames = slotFrames.filter((frame) => frame.motion === selectedMotion).sort((a, b) => a.frame - b.frame);
  const selected = frames.find((frame) => frame.id === selectedFrameId) ?? frames[0] ?? null;
  const expected = selectedMotion === "death" ? [1] : [1, 2, 3, 4];
  const approved = draft.frames.filter((frame) => frame.review === "approved").length;
  const rejected = draft.frames.filter((frame) => frame.review === "rejected").length;
  const percent = draft.totalFrames ? Math.min(100, Math.round(draft.completedFrames / draft.totalFrames * 100)) : 0;
  const canCancel = draft.status === "queued" || draft.status === "running" || draft.status === "cancelling";
  const slotProgress = draft.currentSlot ? SLOT_NAMES[draft.currentSlot] ?? draft.currentSlot : null;
  return <div className="cosmetic-detail-body draft-detail">
    <header className="cosmetic-detail-header"><div><span className="cosmetic-detail-eyebrow">서버 작업 · {draft.id}</span><h2>{draft.name}</h2><p>{statusLabel(draft.status)} · {draft.completedFrames} / {draft.totalFrames} 프레임</p></div><div className="cosmetic-detail-header-actions"><button type="button" className="secondary" onClick={clearSelection}>갤러리 목록</button><button type="button" className="secondary" onClick={openJobs}>작업 목록</button>{canCancel && <button className="secondary danger" type="button" onClick={onCancel} disabled={busy || draft.status === "cancelling"}>{draft.status === "cancelling" ? "취소 중…" : "작업 취소"}</button>}</div></header>
    {draft.conceptUrl && <DraftWebpImage className="cosmetic-draft-concept" url={draft.conceptUrl} alt={`${draft.name} 컨셉`} />}
    <div className="cosmetic-draft-progress"><div className="cosmetic-progress-track"><i style={{ width: `${percent}%` }} /></div><span>{percent}%</span></div>
    {(slotProgress || draft.currentMotion) && <p className="cosmetic-draft-current">현재 진행: {[slotProgress, draft.currentMotion ? MOTION_NAMES[draft.currentMotion] ?? draft.currentMotion : null].filter(Boolean).join(" · ")}</p>}
    {draft.error && <div className="alert error" role="alert">{cosmeticStudioError(draft.error)}</div>}
    <div className="cosmetic-review-summary"><span>승인 {approved}</span><span>문제 있음 {rejected}</span><span>검수 대기 {draft.frames.length - approved - rejected}</span></div>
    <button className="secondary" type="button" disabled={busy || canCancel || !rejected} onClick={onRegenerateRejected}>{mutation === `regenerate-rejected:${draft.id}` ? "거부 프레임 재생성 중…" : `거부 프레임 전체 재생성 (${rejected}개)`}</button>
    <div className="cosmetic-detail-filters">
      <label>아트 그룹<select aria-label="아트 그룹" value="draft"><option value="draft">{draft.name}</option></select></label>
      <label>동작<select aria-label="동작" value={selectedMotion} onChange={(event) => { onMotionChange(event.target.value); onFrameSelect(null); }}>{motions.map((item) => <option key={item} value={item}>{MOTION_NAMES[item] ?? item}</option>)}</select></label>
      <label>부위 그룹<select aria-label="부위 그룹" value={selectedSlot} onChange={(event) => { onSlotChange(event.target.value); onFrameSelect(null); }}>{slots.map((item) => <option key={item} value={item}>{BODY_GROUP_NAMES[item] ?? item}</option>)}</select></label>
      {selectedSlot === "BOTTOM" && <label>무기 변형<select aria-label="무기 변형" value="default"><option value="default">기본 무기</option></select></label>}
    </div>
    <section className="cosmetic-sheet-section">
      <div className="cosmetic-section-heading"><div><h3>프레임 스트립</h3><p>{SLOT_NAMES[selectedSlot]} · {MOTION_NAMES[selectedMotion]}</p></div><span>{frames.length} / {expected.length}개 프레임 파일</span></div>
      <div className="cosmetic-frame-strip" role="list" aria-label="모션 프레임 스트립">{expected.map((number) => {
        const frame = frames.find((item) => item.frame === number);
        return <button key={number} type="button" role="listitem" disabled={!frame} className={frame && selected?.id === frame.id ? "cosmetic-strip-frame selected" : "cosmetic-strip-frame"} onClick={() => frame && onFrameSelect(frame.id)} aria-label={`${number}프레임${frame ? ` · ${reviewLabel(frame.review)}` : " · 생성 대기"}`}>
          <span className="cosmetic-frame-stack-wrap">{frame ? <DraftWebpImage url={frame.url} alt={`${SLOT_NAMES[selectedSlot]} ${number}프레임`} /> : <span className="cosmetic-missing-frame">생성 대기</span>}</span>
          <strong>{String(number).padStart(2, "0")}</strong>{frame && <small className={`cosmetic-review-${frame.review}`}>{reviewLabel(frame.review)}</small>}
        </button>;
      })}</div>
    </section>
    <section className="cosmetic-enlarged-frame cosmetic-draft-frame-detail">
      <div className="cosmetic-section-heading"><div><h3>선택 프레임 확대</h3><p>{SLOT_NAMES[selectedSlot]} · {MOTION_NAMES[selectedMotion]}{selected ? ` ${selected.frame}프레임` : " · 생성 대기"}</p></div></div>
      {selected ? <>
        <div className="cosmetic-enlarged-canvas cosmetic-draft-large-image"><DraftWebpImage url={selected.url} alt={`${SLOT_NAMES[selected.slot]} ${MOTION_NAMES[selected.motion]} ${selected.frame}프레임 확대`} /></div>
        <div className="cosmetic-draft-frame-meta"><span>{selected.width} × {selected.height} · 시안 {selected.revision + 1}</span><span className={`cosmetic-review-${selected.review}`}>{reviewLabel(selected.review)}</span></div>
        <div className="cosmetic-frame-actions"><button type="button" disabled={busy || canCancel} className={selected.review === "approved" ? "selected" : ""} onClick={() => onReview(selected, "approved")}>승인</button><button type="button" disabled={busy || canCancel} className={selected.review === "rejected" ? "selected danger" : ""} onClick={() => onReview(selected, "rejected")}>거부</button><button type="button" disabled={busy || canCancel} onClick={() => onRegenerate(selected)}>{mutation === `regenerate:${selected.id}` ? "재생성 중…" : "이 프레임 재생성"}</button></div>
        {canCancel && <p className="cosmetic-draft-current">생성 작업이 종료되면 프레임을 검수할 수 있습니다.</p>}
      </> : <div className="cosmetic-enlarged-canvas"><span className="cosmetic-missing-frame">선택한 그룹의 프레임이 아직 생성되지 않았습니다.</span></div>}
    </section>
    <footer className="cosmetic-studio-export"><span>{draft.status === "completed" ? `승인 프레임 ${approved}개` : "작업이 완료되면 승인된 프레임을 내보낼 수 있습니다."}</span><button className="primary" type="button" disabled={busy || draft.status !== "completed" || !approved} onClick={onExport}>{mutation === `export:${draft.id}` ? "ZIP 준비 중…" : "승인 프레임 ZIP 내보내기"}</button></footer>
  </div>;
}

function FrameStack({ frames, label, preserveOrder = false }: { frames: GameFrame[]; label: string; preserveOrder?: boolean }) {
  const sorted = preserveOrder ? frames : [...frames].sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.layer.localeCompare(b.layer));
  if (sorted.length === 1 && !sorted[0].crop) return <img src={sorted[0].url} alt={label} loading="lazy" />;
  return <span className="cosmetic-frame-stack" role="img" aria-label={label}>{sorted.map((frame) => <FrameLayer key={frame.id} frame={frame} />)}</span>;
}

function FrameLayer({ frame }: { frame: GameFrame }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
    if (!canvas || !frame.crop) return;
    let active = true;
    let bitmap: ImageBitmap | null = null;
    fetch(frame.url, { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    }).then(createImageBitmap).then((image) => {
      bitmap = image;
      if (!active) return;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      canvas.width = frame.crop!.width; canvas.height = frame.crop!.height;
      context.drawImage(image, frame.crop!.x, frame.crop!.y, frame.crop!.width, frame.crop!.height, 0, 0, frame.crop!.width, frame.crop!.height);
    }).catch(() => { if (active) setBroken(true); });
    return () => { active = false; bitmap?.close(); };
  }, [canvas, frame]);
  if (broken) return <span className="cosmetic-frame-layer-error">이미지 오류</span>;
  return frame.crop ? <canvas ref={setCanvas} aria-label={frame.layer} /> : <img src={frame.url} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function groupOptions(set: CatalogSet): GroupOption[] {
  const artGroups = ART_GROUPS[set.key] ?? [set.key];
  const allowed = new Set(artGroups);
  return [...availableGroups.values()].filter((option) => (option.collection === "game-motion" && allowed.has(option.group)) || (option.collection === set.key && ["angel", "yakgwa"].includes(set.key)))
    .sort((a, b) => {
      const rank = (option: GroupOption) => option.collection === set.key ? 0 : 1;
      return rank(a) - rank(b) || a.group.localeCompare(b.group);
    });
}

function bodyGroupForLayer(layer: string): string {
  for (const [group, layers] of Object.entries(BODY_GROUPS)) if (layers.includes(layer)) return group;
  return "BASE";
}

function layerRank(layer: string): number { const order = LAYER_ORDER.indexOf(layer); return order < 0 ? LAYER_ORDER.length : order; }
function motionOrder(motion: string): number { const order = ["rest", "run", "run2", "strike1", "strike2", "thrust1", "death", "death1"].indexOf(motion); return order < 0 ? 99 : order; }
function bodyGroupOrder(group: string): number { const order = ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE", "BASE"].indexOf(group); return order < 0 ? 99 : order; }
function statusLabel(status: DraftSet["status"]): string { return ({ queued: "대기", running: "생성 중", cancelling: "취소 중", cancelled: "취소됨", completed: "완료", failed: "실패" })[status]; }
function reviewLabel(review: CosmeticReview): string { return review === "approved" ? "승인" : review === "rejected" ? "문제 있음" : "검수 대기"; }
function messageOf(failure: unknown, fallback: string): string { return failure instanceof Error ? failure.message : fallback; }
const BODY_GROUP_NAMES: Record<string, string> = { HEAD: "모자", TOP: "상의 · 몸통 및 소매", BOTTOM: "무기", GLOVES: "장갑 · 손 레이어", SHOES: "신발 · 발 레이어", CAPE: "망토 · 등 레이어", BASE: "기본 몸 레이어" };
function mergeDraftProgress(current: DraftSet, incoming: DraftSet): DraftSet {
  const incomingFrames = new Map(incoming.frames.map((frame) => [frame.id, frame]));
  const frames = current.frames.map((frame) => incomingFrames.get(frame.id) ?? frame);
  const knownIds = new Set(current.frames.map((frame) => frame.id));
  for (const frame of incoming.frames) if (!knownIds.has(frame.id)) frames.push(frame);
  return { ...current, ...incoming, frames };
}
