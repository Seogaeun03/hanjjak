package com.hanjjak.gems.domain

import java.time.Instant

/**
 * `gem_account_state` 에 저장된 티켓 행. 아직 행이 없는 계정은 `null` 로 넘긴다.
 */
data class StoredGemTickets(val tickets: Int, val lastTicketAt: Instant)

/**
 * 지금 이 순간 유효한 티켓. 조회가 화면에 내보내는 값이자, 변경 명령이 저장할 값이다.
 *
 * [rechargeAnchor] 는 다음 충전을 세는 기준 시각 — `gem_account_state.last_ticket_at` 이다.
 */
data class GemTicketBalance(val tickets: Int, val rechargeAnchor: Instant, val secondsUntilNextTicket: Long)

/**
 * Operational knobs for the gem dungeon loop.
 *
 * The defaults are the applied v2 service values. Older applied and beta content resources remain
 * immutable and can be selected through `hanjjak.gem-dungeon.*` for replay or rollback.
 */
data class GemDungeonPolicy(
    val rotationPeriodSeconds: Long = 3_600,
    val ticketRegenSeconds: Long = 3_600,
    val ticketMaxStock: Int = 3,
    val ticketInitialGrant: Int = 3,
    val contentResource: String = "classpath:gem-dungeons/gem-dungeons-v2.json",
    val contentAuthority: String = "applied",
) {
    init {
        require(rotationPeriodSeconds > 0) { "INVALID_GEM_DUNGEON_ROTATION_PERIOD" }
        require(ticketRegenSeconds > 0) { "INVALID_GEM_TICKET_REGEN_INTERVAL" }
        require(ticketMaxStock >= 1) { "INVALID_GEM_TICKET_MAX_STOCK" }
        require(ticketInitialGrant in 0..ticketMaxStock) { "INVALID_GEM_TICKET_INITIAL_GRANT" }
    }

    /**
     * KST-aligned rotation slot index. The applied 3,600 second period opens a new boss every KST
     * hour; the former 86,400 second period remains supported for v1 replay and rollback.
     */
    fun slotIndex(now: Instant): Long = Math.floorDiv(now.epochSecond + KST_OFFSET_SECONDS, rotationPeriodSeconds)

    fun slotStartedAt(now: Instant): Instant =
        Instant.ofEpochSecond(slotIndex(now) * rotationPeriodSeconds - KST_OFFSET_SECONDS)

    fun secondsUntilNextSlot(now: Instant): Long =
        rotationPeriodSeconds - (now.epochSecond - slotStartedAt(now).epochSecond)

    fun ticketSlotIndex(now: Instant): Long =
        Math.floorDiv(now.epochSecond + KST_OFFSET_SECONDS, ticketRegenSeconds)

    fun ticketSlotStartedAt(now: Instant): Instant =
        Instant.ofEpochSecond(ticketSlotIndex(now) * ticketRegenSeconds - KST_OFFSET_SECONDS)

    fun secondsUntilNextTicketSlot(now: Instant): Long =
        ticketRegenSeconds - (now.epochSecond - ticketSlotStartedAt(now).epochSecond)

    /**
     * 저장된 행과 지금 시각만으로 유효 티켓을 계산한다. 조회와 변경이 함께 쓰는 하나의 식이다.
     *
     * 예전에는 이 계산이 저장과 한 몸이라, 보석함이나 던전 화면을 열어 보기만 해도 티켓 행이
     * 생기고 `for update` 로 잠기고 되쓰였다. 읽기가 쓰기 잠금을 잡은 셈이다. 계산을 떼어 낸
     * 지금 조회는 읽은 값으로 같은 답을 내고, 저장은 티켓을 바꾸는 명령만 한다.
     *
     * 행이 아직 없는 계정은 최초 지급분을 그대로 보여 준다 — 첫 명령이 같은 값으로 행을 만든다.
     */
    fun ticketBalance(stored: StoredGemTickets?, now: Instant): GemTicketBalance {
        if (stored == null) return balanceOf(ticketInitialGrant, now, now)
        val held = stored.tickets.coerceAtMost(ticketMaxStock)
        val gained = (ticketSlotIndex(now) - ticketSlotIndex(stored.lastTicketAt)).coerceAtLeast(0)
        // 가득 찬 동안에는 시계가 멈춘다. 그래서 채워진 뒤 흐른 시간은 쌓이지 않는다.
        val tickets = if (held >= ticketMaxStock) held else (held + gained).coerceAtMost(ticketMaxStock.toLong()).toInt()
        return balanceOf(tickets, if (gained > 0) ticketSlotStartedAt(now) else stored.lastTicketAt, now)
    }

    /**
     * [balance] 에서 [consume] 장을 뺀 결과. 티켓을 바꾸는 명령만 이 값을 저장한다.
     *
     * 가득 찬 상태에서 한 장을 쓰면 충전 기준이 지금 정각으로 옮겨 붙는다. 가득 차 있는 동안
     * 멈춰 있던 시계를, 자리가 난 순간부터 다시 돌리기 위해서다.
     */
    fun afterConsuming(balance: GemTicketBalance, consume: Int, now: Instant): GemTicketBalance {
        require(consume >= 0) { "INVALID_GEM_TICKET_CONSUMPTION" }
        require(balance.tickets >= consume) { "GEM_TICKET_EMPTY" }
        if (consume == 0) return balance
        val anchor = if (balance.tickets >= ticketMaxStock) ticketSlotStartedAt(now) else balance.rechargeAnchor
        return balanceOf(balance.tickets - consume, anchor, now)
    }

    private fun balanceOf(tickets: Int, rechargeAnchor: Instant, now: Instant): GemTicketBalance =
        GemTicketBalance(tickets, rechargeAnchor, if (tickets >= ticketMaxStock) 0L else secondsUntilNextTicketSlot(now))

    companion object {
        const val KST_OFFSET_SECONDS = 32_400L
    }
}
