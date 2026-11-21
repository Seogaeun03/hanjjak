import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BroadcastBanner, type BannerDataSource } from "./BroadcastBanner";
import type { Banner, BannerTone } from "./api";
import "../../styles.css";

/*
 * 네온 간판을 서버 없이 눈으로 확인한다. 색 세 가지와, 긴 문구가 흐르는 모습과,
 * 창(`<dialog open`)이 떠 있을 때도 배너가 그 위에 남는지를 한 화면에서 본다.
 */
const SAMPLES: Record<BannerTone, string> = {
  INFO: "오늘 22시부터 30분간 점검합니다.",
  EVENT: "주말 감자 축제가 열렸습니다! 던전 보상이 2배로 들어옵니다.",
  WARNING: "거래소 점검 중입니다. 지금 올린 매물은 잠시 뒤 다시 확인해 주세요. 긴 문구는 칸을 넘치면 화면에서 흘러갑니다.",
};

function sample(tone: BannerTone): Banner {
  return { bannerId: tone, message: SAMPLES[tone], tone, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
}

function Preview() {
  const [tones, setTones] = useState<BannerTone[]>(["INFO"]);
  const [modalOpen, setModalOpen] = useState(false);
  const dataSource: BannerDataSource = {
    list: () => Promise.resolve({ items: tones.map(sample) }),
    dismiss: (bannerId: string) => {
      setTones((current) => current.filter((tone) => tone !== bannerId));
      return Promise.resolve({ bannerId, dismissedAt: new Date().toISOString() });
    },
  };
  const toggle = (tone: BannerTone) =>
    setTones((current) => current.includes(tone) ? current.filter((value) => value !== tone) : [...current, tone]);

  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BroadcastBanner key={tones.join("|")} dataSource={dataSource} />
    <div style={{ display: "grid", gap: 14, placeContent: "center", minHeight: "100vh", color: "#f3e6d2" }}>
      <div style={{ display: "flex", gap: 8 }}>
        {(Object.keys(SAMPLES) as BannerTone[]).map((tone) =>
          <button key={tone} type="button" onClick={() => toggle(tone)}>{tone}{tones.includes(tone) ? " 내리기" : " 올리기"}</button>)}
      </div>
      <button type="button" onClick={() => setModalOpen((open) => !open)}>{modalOpen ? "창 닫기" : "창 열기 (top layer 확인)"}</button>
    </div>
    {modalOpen && <TopLayerProbe onClose={() => setModalOpen(false)} />}
  </QueryClientProvider>;
}

/** 실제 화면과 같은 방식으로 창을 연다. `showModal()` 로 열어야 top layer 다툼이 재현된다. */
function TopLayerProbe({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={onClose} style={{ padding: 24 }}>
    <p>이 창은 화면 맨 위 층에 있습니다. 배너가 이 위에 남아야 합니다.</p>
    <button type="button" onClick={onClose}>닫기</button>
  </dialog>;
}

document.body.style.minHeight = "100vh";
document.body.style.margin = "0";
document.body.style.background = "radial-gradient(circle at 50% 35%, #56412e, #1d130c 72%)";

createRoot(document.getElementById("root")!).render(<Preview />);
