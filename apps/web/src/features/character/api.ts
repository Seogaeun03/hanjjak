import type { QueryClient } from "@tanstack/react-query";
import type { Collection, CosmeticState, StatEffect } from "../cosmetics/api";
import { rememberCosmeticColor } from "../cosmetics/cosmeticColor";

export type StatSource = { sourceId: string; label: string; category: string; value: number; unit: string; applied: boolean; reason: string | null };
export type CharacterStat = { statId: string; label: string; unit: string; total: number; base: number; additional: number; sources: StatSource[]; calculation: string };
export type CharacterStats = { nickname: string; level: number; experience: number; combatPower?: number; cosmeticsUnlocked: boolean; contentVersion: string; stats: CharacterStat[]; notices?: string[] };
/** 목록을 받을 때마다 고른 색을 기억해 둔다. 화면이 색을 물어볼 자리가 너무 많다. */
const remember = <T extends { color?: string | null }>(collection: T): T => { rememberCosmeticColor(collection.color); return collection; };

export type CharacterCollection = Omit<Collection, "states"> & { contentVersion: string; states: Array<CosmeticState & { canUpgrade: boolean; upgradeDisabledReason: string | null }> };
export type BulkRegistrationResult = { upgradedCount: number; collection: CharacterCollection };
export type CatalogCosmetic = { cosmeticId: string; displayName: string | null; grade: string; slot: string; /** 세트에 속하지 않는 치장은 비어 있다. */ setId: string | null; imageUrl: string | null };
export type CosmeticCatalog = { contentVersion: string; cosmetics: CatalogCosmetic[]; sets: Array<{ setId: string; displayName: string | null; previewImageUrl?: string | null; grade: string; members: Record<string, string>; effects: Record<string, StatEffect[]> }> };
export type CharacterCommand = { kind: "register"; cosmeticId: string; key: string } | { kind: "bulkRegister"; key: string } | { kind: "equip"; slot: string; cosmeticId: string | null; key: string } | { kind: "color"; color: string | null; key: string };
export type CharacterCommandResult = CharacterCollection | BulkRegistrationResult;

export class CharacterApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function isUncertainCommandError(error: unknown) {
  return !(error instanceof CharacterApiError) || error.status >= 500;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new CharacterApiError(response.status, typeof body.code === "string" ? body.code : "REQUEST_FAILED");
  return body.data as T;
}

export function clearExpiredSession(client: QueryClient, error: unknown) {
  if (error instanceof CharacterApiError && error.status === 401) {
    client.removeQueries({ predicate: query => query.queryKey[0] !== "auth" });
    client.setQueryData(["auth", "session"], { authenticated: false, account: null, administrator: false });
  }
}

export const characterApi = {
  stats: () => fetch("/api/v1/character/stats", { credentials: "include" }).then(json<CharacterStats>),
  collection: () => fetch("/api/v1/cosmetics/collection", { credentials: "include" }).then(json<CharacterCollection>).then(remember),
  catalog: () => fetch("/api/v1/cosmetics/catalog", { credentials: "include" }).then(json<CosmeticCatalog>),
  chooseColor: (color: string | null, key: string) => fetch("/api/v1/cosmetics/color", {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ color }),
  }).then(json<CharacterCollection>),
  command: (command: CharacterCommand) => {
    const path = command.kind === "register" ? `/api/v1/cosmetics/${encodeURIComponent(command.cosmeticId)}/registrations`
      : command.kind === "bulkRegister" ? "/api/v1/cosmetics/registrations/bulk-upgrade"
      : command.kind === "color" ? "/api/v1/cosmetics/color"
        : `/api/v1/cosmetics/equipment/${encodeURIComponent(command.slot)}`;
    const body = command.kind === "register" ? { mode: "UNTIL_NEXT_STAR" }
      : command.kind === "bulkRegister" ? {}
      : command.kind === "color" ? { color: command.color }
        : { cosmeticId: command.cosmeticId };
    return fetch(path, {
      method: command.kind === "register" || command.kind === "bulkRegister" ? "POST" : "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": command.key },
      body: JSON.stringify(body),
    }).then(json<CharacterCommandResult>).then(result => "upgradedCount" in result
      ? { ...result, collection: remember(result.collection) }
      : remember(result));
  },
};

// Cache effects belong to the sent command, so closing its view does not cancel them.
export async function executeCharacterCommands(client: QueryClient, commands: readonly CharacterCommand[]) {
  const initiatingSession = client.getQueryData(["auth", "session"]);
  try {
    let result: CharacterCommandResult | undefined;
    for (const command of commands) result = await characterApi.command(command);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["cosmetic-collection"] }),
      client.invalidateQueries({ queryKey: ["character-stats"] }),
    ]);
    return result;
  } catch (error) {
    // A response sent under an earlier login must not clear a replacement session.
    if (client.getQueryData(["auth", "session"]) === initiatingSession) clearExpiredSession(client, error);
    throw error;
  }
}

export async function executeCharacterCommand(client: QueryClient, command: CharacterCommand) {
  return executeCharacterCommands(client, [command]);
}
