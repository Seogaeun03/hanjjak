import type { AutoBattleClient } from "./autoBattleClient";

let activeClient: AutoBattleClient | null = null;

export function registerAutoBattleClient(client: AutoBattleClient | null): void {
  activeClient = client;
}

export async function abortActiveBattle(keepalive = false): Promise<void> {
  await activeClient?.stop(keepalive);
}

export async function heartbeatActiveBattle(): Promise<void> {
  await activeClient?.heartbeatNow();
}

export async function restartActiveBattle(serverClosedBattle = false): Promise<boolean> {
  if (!activeClient || (!activeClient.active && !serverClosedBattle)) return false;
  if (activeClient.active) await activeClient.stop();
  await activeClient.start();
  return true;
}
