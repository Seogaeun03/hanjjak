/*
 * 거래소 왼쪽 칸. 분류 · 계열 · 등급 세 층이 한 그루로 서 있고, 누른 줄만 그 자리에서
 * 아래로 열린다. 화면을 갈아 끼우면 방금 무엇을 눌렀는지, 옆에 무엇이 있었는지가
 * 사라져 길을 잃는다. 열린 줄은 제자리에 남아 이정표가 되고, 다시 누르면 닫힌다.
 *
 * 줄을 누르면 그 하나만 보되 값마다 다 편다. 오른쪽 체크 표시로 여럿을 골라 두면
 * 저마다 가장 싼 값 한 줄씩만 세워 나란히 견준다. 맨 아래 최근 본 아이템은 되돌아
 * 가는 지름길이라 체크 표시를 두지 않는다 — 견주기는 위에서 하는 일이다.
 */
import { useMemo } from "react";
import { valueText } from "../gems/GemManagement";
import { InstrumentIcon } from "./MarketScreen";
import { PlazaIcon } from "./PlazaIcon";
import { gemIcon, instrumentShortName, instrumentTagTone, instrumentVariant, skillbookIcon, swordIcon } from "./marketArt";
import { browseRows, browseTo, comparedIds, toggleCategory, toggleCompare, toggleGroup, type MarketBrowse, type MarketBrowseCategory } from "./marketBrowse";
import type { MarketInstrument } from "./api";

/*
 * 분류 그림은 붙박이다. 예전에는 그 분류의 첫 품목에서 그림을 빌려 왔는데, 감자가
 * 강화재료를, 어느 비법서 하나가 스킬북 전체를 대표하게 되어 무엇을 가리키는지
 * 읽히지 않았다. "전체"만은 어느 품목도 대표할 수 없으므로 네 칸 무늬를 그린다.
 */
const CATEGORY_ART: Record<Exclude<MarketBrowseCategory, "ALL">, string> = {
  MATERIAL: swordIcon,
  SKILL_BOOK: skillbookIcon,
  GEM: gemIcon,
};

export function MarketItemBrowser({ catalog, selected, browse, onBrowse, onSelect, recent }: {
  catalog: MarketInstrument[];
  selected: MarketInstrument;
  browse: MarketBrowse;
  onBrowse: (browse: MarketBrowse) => void;
  onSelect: (instrumentId: string) => void;
  /** 최근 거래 칸에 올려 본 품목. 가장 최근이 앞이다. */
  recent: MarketInstrument[];
}) {
  const rows = useMemo(() => browseRows(catalog, browse), [catalog, browse]);
  const compared = comparedIds(browse.pick);
  const searching = Boolean(browse.query.trim());

  /* 체크를 더하면 그것을 거래 칸에 올리고, 거래하던 것을 빼면 남은 것 중 마지막으로 옮긴다. */
  const check = (id: string) => {
    const pick = toggleCompare(browse.pick, id);
    const ids = pick?.kind === "compare" ? pick.ids : [];
    if (ids.includes(id)) onSelect(id);
    else if (selected.instrumentId === id && ids.length) onSelect(ids[ids.length - 1]);
    onBrowse({ ...browse, pick });
  };

  return <aside className="market-browser" aria-label="품목 찾기">
    <div className="market-browser-search">
      <PlazaIcon name="search" />
      <input
        aria-label="품목 검색" placeholder="아이템을 검색하세요…" value={browse.query}
        onChange={event => onBrowse({ ...browse, query: event.currentTarget.value, pick: null })}
      />
      {browse.query && <button type="button" aria-label="검색어 지우기" onClick={() => onBrowse({ ...browse, query: "", pick: null })}><PlazaIcon name="close" /></button>}
    </div>

    <div className="market-browser-list">
      {rows.length === 0
        ? <p className="market-browser-empty">{searching ? "그런 이름의 물품이 없어요." : "여기에 등록된 물품이 없어요."}</p>
        : <ul className="market-browser-rows">{rows.map(row => {
          if (row.kind === "category") return <li key={row.id} data-depth={row.depth}>
            <button
              type="button" className={`market-browser-row${row.open ? " is-open" : ""}`}
              aria-expanded={row.open} onClick={() => onBrowse(toggleCategory(browse, row.id))}
            >
              <span className="market-browser-art">{row.id === "ALL" ? <PlazaIcon name="grid" /> : <img src={CATEGORY_ART[row.id]} alt="" />}</span>
              <strong>{row.label}</strong>
              <small className="market-browser-count">{row.count}</small>
              <PlazaIcon name="chevron" className={row.open ? "is-open" : undefined} />
            </button>
          </li>;
          if (row.kind === "group") return <li key={row.key} data-depth={row.depth}>
            <button
              type="button" className={`market-browser-row${row.open ? " is-open" : ""}`}
              aria-expanded={row.open} onClick={() => onBrowse(toggleGroup(browse, row.key))}
            >
              <span className="market-browser-art"><InstrumentIcon item={row.sample} skillArtOnly /></span>
              <strong>{row.label}</strong>
              <small className="market-browser-count">{row.count}</small>
              <PlazaIcon name="chevron" className={row.open ? "is-open" : undefined} />
            </button>
          </li>;
          const { item } = row;
          const name = instrumentShortName(item);
          const variant = instrumentVariant(item, valueText);
          return <li key={item.instrumentId} className="market-browser-leaf" data-depth={row.depth}>
            <button
              type="button" className="market-browser-row"
              aria-pressed={browse.pick?.kind === "one" && browse.pick.id === item.instrumentId}
              onClick={() => { onSelect(item.instrumentId); onBrowse({ ...browse, pick: { kind: "one", id: item.instrumentId } }); }}
            >
              <span className="market-browser-art"><InstrumentIcon item={item} skillArtOnly /></span>
              <strong>{name}</strong>
              <em className={`market-browser-tag ${instrumentTagTone(item)}`}>{variant}</em>
            </button>
            {/* 체크 표시는 "이것도 같이 견주자"는 뜻이다. 줄을 누르는 것과는 다른 일이라 단추를 따로 둔다. */}
            <label className="market-browser-check" title={`${name} ${variant} 최저가 견주기`}>
              <input
                type="checkbox" aria-label={`${name} ${variant} 최저가 견주기`}
                checked={compared.has(item.instrumentId)} onChange={() => check(item.instrumentId)}
              />
              <span aria-hidden="true"><PlazaIcon name="tick" /></span>
            </label>
          </li>;
        })}</ul>}
    </div>

    {/*
      * 비어 있어도 자리는 내어 둔다. 하나씩 쌓일 때마다 칸이 자라면 그만큼 위 목록이
      * 밀려 올라가, 방금 누르려던 줄이 손끝에서 달아난다. 점선은 처음부터 같은 자리다.
      */}
    <section className="market-browser-recent" aria-label="최근 본 아이템">
      <h4>최근 본 아이템</h4>
      {recent.length === 0
        ? <p className="market-browser-recent-empty">고른 물품이 여기 남아요.</p>
        : <ul>{recent.map(item => <li key={item.instrumentId}>
        <button
          type="button" className="market-browser-row"
          aria-pressed={item.instrumentId === selected.instrumentId}
          onClick={() => { onSelect(item.instrumentId); onBrowse(browseTo(item)); }}
        >
          <span className="market-browser-art"><InstrumentIcon item={item} skillArtOnly /></span>
          <strong>{instrumentShortName(item)}</strong>
          <em className={`market-browser-tag ${instrumentTagTone(item)}`}>{instrumentVariant(item, valueText)}</em>
        </button>
      </li>)}</ul>}
    </section>
  </aside>;
}
