/* 최초 클리어 보상은 스테이지를 처음 깬 순간 전투 결과에 실려 와 모달로 알려 준다.
   따로 모아 보는 화면은 두지 않으므로, 여기에는 그 결과를 읽는 타입만 남긴다. */
export type FirstClearRewardItem = {
  itemId: string;
  displayName: string;
  quantity: number;
};

export type FirstClearRewardResult = {
  rewardId: string;
  stageId: string;
  rewardVersion: string;
  firstClear: boolean;
  riceGranted: number;
  /** 치장 뽑기권. 쌀과 같이 지갑으로 들어가므로 가방이 모자라도 대기하지 않는다. */
  ticketsGranted: number;
  grantedItems: FirstClearRewardItem[];
  pendingItems: FirstClearRewardItem[];
  unlockedSkillId: string | null;
  itemStatus: string;
  requiredSlots: number;
  availableSlots: number;
  missingSlots: number;
};
