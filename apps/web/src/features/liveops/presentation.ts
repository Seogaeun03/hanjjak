/* 서버는 require/check 메시지를 SCREAMING_SNAKE_CASE 코드로 그대로 던진다. 화면은 그걸
   플레이어가 읽을 한국어로 바꿔서 보여 줘야 한다. cosmeticsErrorMessage 와 같은 모양이다:
   알려진 코드는 구체적인 안내로, 모르는 코드도 빈 문자열이 아니라 읽을 수 있는 기본
   문구로 떨어진다. */
const ERROR_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "로그인이 필요합니다. 다시 로그인해 주세요.",
  LIVEOPS_EVENT_NOT_FOUND: "해당 이벤트를 찾을 수 없습니다.",
  LIVEOPS_EVENT_HALTED: "이벤트가 일시 중단되어 있습니다. 잠시 후 다시 시도해 주세요.",
  INVALID_DRAW_COUNT: "뽑기 횟수가 올바르지 않습니다.",
  INSUFFICIENT_EVENT_TICKETS: "보유한 이벤트 티켓이 부족합니다.",
  LIVEOPS_PRIZE_AWARD_CONFLICT: "경품 지급을 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.",
  /* 보석함은 가방 칸을 쓴다. 뽑기는 티켓을 쓰기 전에 여유를 확인하고 거부하므로,
     티켓이 줄지 않았다는 것까지 알려 줘야 플레이어가 다시 시도할지 판단할 수 있다. */
  INVENTORY_CAPACITY_EXCEEDED: "가방이 가득 차 보석함을 받을 수 없습니다. 가방을 정리한 뒤 다시 시도해 주세요. 티켓은 사용되지 않았습니다.",
};

export function liveopsErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "이벤트 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
