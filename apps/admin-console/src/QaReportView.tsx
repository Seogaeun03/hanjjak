import { useCallback, useEffect, useState } from "react";
import { AdminQaReport, createApiClient } from "@hanjjak/client-sdk";
import { adminErrorMessage } from "./presentation";

const api = createApiClient().admin;

/*
 * 유저가 설정 화면에서 보낸 버그 신고를 읽는 자리다. 신고는 화면 주소와 창 크기를
 * 함께 지고 오므로, 글만 읽고 짐작하는 대신 어느 화면 어느 크기에서 벌어진 일인지
 * 바로 짚을 수 있다. 사진은 목록에 싣지 않고 고른 한 건만 불러온다.
 */
export function QaReportView() {
  const [reports, setReports] = useState<AdminQaReport[]>([]);
  const [selected, setSelected] = useState<AdminQaReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await api.qaReports(200);
      setReports(data);
      setSelected((current) => (current && data.some((row) => row.reportId === current.reportId) ? current : data[0] ?? null));
      setStatus("ready");
    } catch (failure) {
      setError(adminErrorMessage(failure));
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <div className="content">
    <section className="overview-head">
      <div>
        <p>유저가 설정 화면에서 보낸 버그 신고입니다. 최신 접수가 위에 옵니다.</p>
        <span>신고한 화면 주소와 창 크기가 함께 저장되어, 재현할 조건을 그대로 따라갈 수 있습니다.</span>
      </div>
      <button className="secondary" type="button" onClick={() => void load()} disabled={status === "loading"}>↻ 새로고침</button>
    </section>

    {error && <div className="alert error" role="alert">{error}</div>}

    <div className="qa-layout">
      <article className="panel qa-list" aria-label="신고 목록">
        {status === "loading" && reports.length === 0
          ? <p className="qa-empty">신고를 불러오는 중입니다.</p>
          : reports.length === 0
            ? <p className="qa-empty">접수된 신고가 없습니다.</p>
            : reports.map((report) => <button
              key={report.reportId}
              type="button"
              className={selected?.reportId === report.reportId ? "qa-row active" : "qa-row"}
              onClick={() => setSelected(report)}
            >
              <span className="qa-row-when">{formatWhen(report.createdAt)}</span>
              <strong className="qa-row-text">{firstLine(report.description)}</strong>
              <span className="qa-row-meta">
                {report.reporterNickname ?? "닉네임 없음"}
                {report.hasImage && <i className="qa-shot" title="사진 첨부">📷</i>}
              </span>
            </button>)}
      </article>

      <article className="panel qa-detail" aria-label="신고 상세">
        {selected ? <QaReportDetail report={selected} /> : <p className="qa-empty">왼쪽에서 신고를 고르면 내용이 보입니다.</p>}
      </article>
    </div>
  </div>;
}

function QaReportDetail({ report }: { report: AdminQaReport }) {
  return <>
    <header className="qa-detail-head">
      <div>
        <span className="eyebrow">QA BUG REPORT</span>
        <h2>{report.reporterNickname ?? "닉네임 없음"}</h2>
        <small className="mono">{report.reporterAccountId}</small>
      </div>
      <time>{formatWhen(report.createdAt)}</time>
    </header>

    <p className="qa-description">{report.description}</p>

    <dl className="qa-facts">
      <div><dt>신고한 화면</dt><dd className="mono">{report.pageUrl}</dd></div>
      <div><dt>창 크기</dt><dd>{report.viewportWidth.toLocaleString()} × {report.viewportHeight.toLocaleString()}</dd></div>
      <div><dt>브라우저</dt><dd className="mono qa-agent">{report.userAgent}</dd></div>
    </dl>

    {report.hasImage
      ? <figure className="qa-shot-figure">
        <img src={api.qaReportImageUrl(report.reportId)} alt={`${report.reporterNickname ?? "유저"}가 첨부한 화면`} />
        <figcaption>첨부한 화면 · 눌러서 새 창에서 크게 보기 <a href={api.qaReportImageUrl(report.reportId)} target="_blank" rel="noreferrer">열기</a></figcaption>
      </figure>
      : <p className="qa-empty">첨부한 사진이 없습니다.</p>}
  </>;
}

/** 목록에는 첫 줄만 세운다. 긴 신고도 한 줄 높이를 지키게 한다. */
function firstLine(description: string): string {
  const line = description.split("\n").find((row) => row.trim()) ?? description;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function formatWhen(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}
