import type { MailMessage } from "./api";

/*
 * 거래소 판매 정산은 거래소의 받기 칸이 맡는다. 같은 우편을 두 곳에서 보여 주면
 * 한쪽에서 받은 것이 다른 쪽에서 소리 없이 사라져 무슨 일이 일어났는지 알 수 없다.
 * 이 함에는 운영자가 보내는 것만 담는다.
 *
 * 전투 HUD 의 메시지함 단추도 이 셈을 쓴다. 메시지함 화면은 눌러야 받아 오는
 * 청크라, 걸러 내는 규칙만 따로 두어 첫 화면이 화면째 끌어오지 않게 한다.
 */
export const MARKET_MAIL_TYPES = new Set(["MARKET_SETTLEMENT"]);

export function giftMailOnly(items: MailMessage[]): MailMessage[] {
  return items.filter((mail) => !MARKET_MAIL_TYPES.has(mail.type));
}
