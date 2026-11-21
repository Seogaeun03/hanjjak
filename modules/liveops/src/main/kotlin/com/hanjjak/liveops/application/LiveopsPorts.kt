package com.hanjjak.liveops.application

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

interface LiveopsRepository {
    data class AccrualRow(val accruedSeconds: Long, val grantedToday: Long, val lastTickAt: Instant)
    data class StockRow(val total: Long, val claimed: Long)

    /** 오늘 행을 잠그고 없으면 [now] 를 `last_tick_at` 으로 만든다. 소급 적립을 막는 지점이다. */
    fun lockOrCreateAccrual(eventId: String, accountId: UUID, kstDate: LocalDate, now: Instant): AccrualRow
    fun saveAccrual(eventId: String, accountId: UUID, kstDate: LocalDate, accruedSeconds: Long, grantedToday: Long, lastTickAt: Instant)

    fun creditTickets(eventId: String, accountId: UUID, amount: Long)
    fun ticketBalance(eventId: String, accountId: UUID): Long
    fun lockTicketBalance(eventId: String, accountId: UUID): Long
    fun debitTickets(eventId: String, accountId: UUID, amount: Long)

    fun findDrawResult(eventId: String, accountId: UUID, commandId: UUID): String?
    fun saveDraw(drawId: UUID, eventId: String, accountId: UUID, commandId: UUID, contentVersion: String, resultJson: String, drawnAt: Instant)

    /**
     * 경품 재고 행을 없으면 만든다. 이미 있으면 손대지 않는다(운영자가 DB 에서 조정한 `total` 을
     * 재시작이 되돌리면 안 된다).
     *
     * 지급을 멈추는 정석은 둘뿐이다: `liveops_switch.halted = true` (뽑기·적립을 모두 막는다) 또는
     * `update liveops_prize_stock set total = claimed` (경품만 막는다, 뽑기·적립은 계속된다).
     * `liveops_prize_stock` 행을 지우는 것은 정석이 아니다 — 다음 뽑기나 화면 조회가 이 메서드로
     * 행을 재시딩한다. 이때 `claimed` 는 `liveops_prize_win` 의 실제 당첨 수에서 다시 세운다(0 이
     * 아니다), 그렇지 않으면 이미 내준 실물 경품(재고 5개, 계정당 1개, 운영자가 게임 밖에서
     * 전달)을 잊고 새 계정들에 같은 개수를 더 내주게 된다.
     */
    fun ensurePrizeStock(eventId: String, prizeId: String, total: Long)
    /** 화면 조회용. 결제하지 않으므로 행을 잠그지 않는다. */
    fun readPrizeStock(eventId: String, prizeId: String): StockRow
    fun readAccrual(eventId: String, accountId: UUID, kstDate: LocalDate): AccrualRow?
    fun lockPrizeStock(eventId: String, prizeId: String): StockRow
    fun incrementPrizeClaimed(eventId: String, prizeId: String)
    fun countPrizeWins(eventId: String, prizeId: String, accountId: UUID): Long
    /** 이미 당첨한 계정이면 예외 없이 false 를 준다. 판정은 호출자가 한다. */
    fun insertPrizeWin(winId: UUID, eventId: String, prizeId: String, accountId: UUID, drawId: UUID, wonAt: Instant): Boolean

    data class WinRow(
        val winId: UUID,
        val prizeId: String,
        val accountId: UUID,
        val status: String,
        val operatorNote: String?,
        val wonAt: Instant,
        val updatedAt: Instant,
    )

    fun sumGrantedTickets(eventId: String): Long
    fun sumOutstandingTickets(eventId: String): Long
    fun countDraws(eventId: String): Long
    /** 결과 종류별 회차 수. 뽑기 한 행이 열 회차를 담고 있어 줄 단위로 펼쳐 센다. */
    fun outcomeCounts(eventId: String): Map<String, Long>
    fun listWins(eventId: String, limit: Int): List<WinRow>
    fun setHalted(eventId: String, halted: Boolean, reason: String?, updatedBy: String, at: Instant)
    fun updateWinStatus(winId: UUID, status: String, operatorNote: String?, at: Instant): Boolean

    fun ensureSwitch(eventId: String)
    fun isHalted(eventId: String): Boolean
}

/**
 * 계정 행을 잠근다. game-api 가 `select id from account where id=? for update` 로 연결한다.
 *
 * 저장소 전체의 잠금 순서는 `account → 그 외 행 → wallet` 이다(`BattleController`,
 * `BattleSessionService`, `BattleModeService`, `JdbcCosmeticsRepository` 등 계정을 다루는
 * 모든 커맨드가 이 순서를 지킨다). `draw()` 는 이 순서를 지키려고 가장 먼저 이 포트를 부른다 —
 * 그러지 않으면 하트비트 적립 경로(`account` 를 먼저 잠그고 `liveops_ticket_balance` 를 나중에
 * 잠근다)와 반대 순서로 잠가 두 트랜잭션이 서로의 잠금을 기다리는 교착이 생긴다.
 *
 * `modules/liveops` 는 `account` 표를 직접 알지 못한다 — 쌀·치장 뽑기권·당첨 안내와 같은
 * 자리의 포트다.
 */
fun interface LiveopsAccountLock {
    fun lock(accountId: UUID)
}

/** 쌀을 계정 지갑에 올린다. game-api 가 WalletService 로 연결한다. */
fun interface LiveopsRiceCredit {
    fun credit(accountId: UUID, amount: Long, sourceId: UUID)
}

/** 치장 뽑기권을 올린다. game-api 가 character.cosmetic_ticket_balance 로 연결한다. */
fun interface LiveopsCosmeticTicketCredit {
    fun credit(accountId: UUID, amount: Long)
}

/**
 * 보석함을 가방에 올린다. game-api 가 InventoryRewardService 로 연결한다.
 *
 * 쌀·치장 뽑기권과 달리 보석함은 가방 칸을 쓰는 인벤토리 아이템이라 포트가 두 갈래다.
 * [preflight] 는 티켓을 쓰기 전에 여유를 확인하고 모자라면 `INVENTORY_CAPACITY_EXCEEDED`
 * 로 거부한다. 굴림이 끝난 뒤에야 가방이 모자란 것을 알면 회차를 통째로 되돌려야 하고,
 * 그러면 플레이어는 "왜 실패했는지" 를 알 방법이 없다.
 *
 * `modules/liveops` 는 인벤토리 표를 직접 알지 못한다 — 쌀·치장 뽑기권과 같은 자리의 포트다.
 */
interface LiveopsGemBoxCredit {
    fun preflight(accountId: UUID, quantity: Long)
    fun credit(accountId: UUID, quantity: Long)
}

/** 경품 당첨 안내. 보상이 없는 안내 전용 우편이며 개인정보를 요구하지 않는다. */
fun interface LiveopsPrizeNotice {
    fun notify(accountId: UUID, prizeDisplayName: String, winId: UUID, at: Instant)
}
