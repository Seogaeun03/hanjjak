import type { QueryClient } from "@tanstack/react-query";
import { battleApi } from "../battle/api";
import { materialPreferenceApi } from "../material-preference/api";
import { discardPrefetchedRuntimeState, prefetchRuntimeState } from "./api";

/*
 * 로그인 확인 뒤 화면은 AuthGate → MaterialPreferenceGate → RuntimeLifecycle 순서로 열린다.
 * 각 단계가 앞 단계의 응답을 기다린 뒤에야 자기 요청을 보내 LCP 배경까지 API 가 세 번 줄을 섰다.
 * 세션이 확인되는 즉시 다음 단계들이 쓸 요청을 한꺼번에 보내 두고, 각 단계는 그 결과를 받아 간다.
 */
export function prefetchAuthenticatedBootstrap(client: QueryClient): void {
  void client.prefetchQuery({ queryKey: ["material-preference"], queryFn: materialPreferenceApi.get, retry: false });
  void client.prefetchQuery({ queryKey: ["stages"], queryFn: battleApi.stages });
  prefetchRuntimeState();
}

export function discardAuthenticatedBootstrap(): void {
  discardPrefetchedRuntimeState();
}

/*
 * 같은 키를 여러 화면이 동시에 구독한다. staleTime 이 0 이면 구독자가 새로 붙을 때마다 다시 받아
 * 첫 진입에서 /auth/session 이 두 번 나갔다. 값이 바뀌는 경로는 모두 invalidate/setQueryData 를
 * 부르므로 짧은 staleTime 은 갱신을 늦추지 않는다.
 */
export function configureBootstrapQueryDefaults(client: QueryClient): void {
  client.setQueryDefaults(["auth", "session"], { staleTime: 5_000 });
  client.setQueryDefaults(["material-preference"], { staleTime: 30_000 });
  client.setQueryDefaults(["stages"], { staleTime: 60_000 });
}
