import type { QueryClient } from "@tanstack/react-query";
import { gemDungeonsApi, gemsApi } from "./api";

/** Share the screen's cache keys; never request locked dungeon data. */
export async function prefetchDungeonData(client: QueryClient): Promise<void> {
  const state = await client.fetchQuery({ queryKey: ["gems"], queryFn: gemsApi.state, retry: false });
  if (!state.unlocked) return;
  await client.prefetchQuery({
    queryKey: ["gem-dungeons", "today", undefined],
    queryFn: () => gemDungeonsApi.today(),
    retry: false,
  });
}
