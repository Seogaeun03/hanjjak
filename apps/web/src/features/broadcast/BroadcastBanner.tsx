import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bannerApi, type Banner } from "./api";
import { useBannerHost } from "./useBannerHost";
import "./BroadcastBanner.css";

export type BannerDataSource = Pick<typeof bannerApi, "list" | "dismiss">;

/** 서버에 다음 배너를 물어보는 간격. 운영자가 올린 뒤 늦어도 이만큼 안에는 화면에 뜬다. */
const POLL_MS = 30_000;

/**
 * 운영자가 올린 배너를 어느 화면에서든 맨 위에 건다.
 *
 * 노출 기간이 끝나는 시각은 배너마다 이미 알고 있으므로, 다음 조회를 기다리지 않고
 * 그 시각에 맞춰 스스로 내린다. 그러지 않으면 "10시까지"라고 적힌 배너가 10시 29분까지
 * 걸려 있는 일이 생긴다.
 */
export function BroadcastBanner({ dataSource = bannerApi }: { dataSource?: BannerDataSource } = {}) {
  const client = useQueryClient();
  const banners = useQuery({
    queryKey: ["banners"],
    queryFn: dataSource.list,
    retry: false,
    refetchInterval: POLL_MS,
  });
  const [now, setNow] = useState(() => Date.now());
  /*
   * 닫은 배너를 화면이 직접 기억한다. 서버에 알리는 사이에도 조회는 계속 돌기 때문에,
   * 기록이 닿기 전에 돌아온 응답이 방금 닫은 배너를 다시 걸어 버린다.
   */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const dismiss = useMutation({
    mutationFn: dataSource.dismiss,
    onMutate: (bannerId: string) => setDismissed((current) => new Set(current).add(bannerId)),
    onSettled: () => { void client.invalidateQueries({ queryKey: ["banners"] }); },
  });

  const items = banners.data?.items ?? [];
  const live = useMemo(
    () => items.filter((banner) => !dismissed.has(banner.bannerId) && Date.parse(banner.expiresAt) > now),
    [dismissed, items, now],
  );

  /* 가장 가까운 만료 시각에만 시계를 맞춘다. 배너가 없으면 시계도 돌지 않는다. */
  useEffect(() => {
    const next = items
      .map((banner) => Date.parse(banner.expiresAt))
      .filter((moment) => Number.isFinite(moment) && moment > now)
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, POLL_MS));
    return () => window.clearTimeout(timer);
  }, [items, now]);

  const { host, ref } = useBannerHost();
  if (live.length === 0) return null;

  const stack = <div className="broadcast-banner-stack" ref={ref} popover="manual" role="status" aria-live="polite" aria-label="운영 공지">
    {live.map((banner) => <BannerRow key={banner.bannerId} banner={banner} onDismiss={() => dismiss.mutate(banner.bannerId)} />)}
  </div>;
  return createPortal(stack, host ?? document.body);
}

function BannerRow({ banner, onDismiss }: { banner: Banner; onDismiss: () => void }) {
  /* 문장이 칸보다 길 때만 흘려 보낸다. 짧은 문장까지 움직이면 읽기만 어려워진다. */
  const track = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLElement>(null);
  const [marquee, setMarquee] = useState(false);
  /*
   * 재는 것은 글자 자체이고, 흐르게 하는 것은 글자를 감싼 칸이다. 둘을 같은 요소에 두면
   * 흐르려고 붙인 여백이 다음 측정에 섞여 들어가, 한 번 흐르기 시작한 문장은 짧아져도
   * 영영 멈추지 않는다.
   */
  useEffect(() => {
    const outer = track.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const measure = () => setMarquee(inner.scrollWidth > outer.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(outer);
    return () => observer?.disconnect();
  }, [banner.message]);

  return <div className={`broadcast-banner broadcast-banner-${banner.tone.toLowerCase()}`}>
    <span className="broadcast-banner-bulb" aria-hidden="true" />
    <span className="broadcast-banner-text" ref={track}>
      <span className={marquee ? "broadcast-banner-run marquee" : "broadcast-banner-run"}>
        <b ref={content}>{banner.message}</b>
      </span>
    </span>
    <button type="button" className="broadcast-banner-close" aria-label="공지 닫기" onClick={onDismiss}>×</button>
  </div>;
}
