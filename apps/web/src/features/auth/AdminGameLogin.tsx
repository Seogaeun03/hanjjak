import { useMutation } from "@tanstack/react-query";
import brandLogo from "./assets-cozy-pixel/auth-brand-logo.png";
import ssafyGitlabButton from "./assets-social/ssafy-gitlab-button.png";
import { adminGameAuthApi } from "./api";

const ERRORS: Record<string, string> = {
  ADMIN_GITLAB_NOT_CONFIGURED: "관리자 GitLab 로그인이 아직 설정되지 않았습니다.",
  ADMIN_GITLAB_AUTHORIZATION_DENIED: "GitLab 로그인이 취소되었습니다.",
  ADMIN_GITLAB_STATE_INVALID: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  ADMIN_GITLAB_ACCESS_DENIED: "허용된 관리자 계정이 아닙니다.",
  ADMIN_PERMISSION_DENIED: "게임에 접속할 관리자 권한이 없습니다.",
};

function callbackError(): string {
  const code = new URLSearchParams(window.location.hash.slice(1)).get("admin-game-auth-error");
  return code ? ERRORS[code] ?? "관리자 로그인을 완료하지 못했습니다." : "";
}

export function AdminGameLogin() {
  const begin = useMutation({
    mutationFn: adminGameAuthApi.begin,
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const error = callbackError();

  return <main className="auth-scene" aria-labelledby="admin-game-login-title">
    <div className="auth-scene__shade" aria-hidden="true" />
    <div className="auth-stage">
      <header className="auth-ticket__title">
        <img src={brandLogo} alt="" />
      </header>
      <section className="auth-ticket auth-ticket--portal admin-game-login-card">
        <div className="auth-ticket__content">
          <div className="auth-art-tabs auth-art-tabs--single"><span>관리자 게임 로그인</span></div>
          <div className="admin-game-login-copy">
            <h1 id="admin-game-login-title">운영 중 게임 접속</h1>
            <p>허용된 관리자 계정은 이벤트 기간과 일일 이용 제한에 관계없이 게임 기능을 점검할 수 있습니다.</p>
          </div>
          <button
            type="button"
            className="auth-social__shell auth-social__shell--gitlab"
            style={{ backgroundImage: `url(${ssafyGitlabButton})` }}
            disabled={begin.isPending}
            onClick={() => begin.mutate()}
          >{begin.isPending ? "GitLab로 이동 중…" : "SSAFY GitLab 관리자 로그인"}</button>
          {(begin.error || error) && <p className="auth-social-error" role="alert">{error || "관리자 로그인을 시작하지 못했습니다."}</p>}
          <a className="admin-game-login-back" href="/">일반 로그인으로 돌아가기</a>
        </div>
      </section>
    </div>
  </main>;
}
