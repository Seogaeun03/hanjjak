package com.hanjjak.liveops.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.domain.LiveopsDrawResult
import com.hanjjak.liveops.domain.LiveopsDrawTable
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID
import kotlin.random.Random

data class LiveopsDrawLine(
    val kind: String,
    val prizeId: String?,
    val prizeDisplayName: String?,
    val quantity: Long,
)

data class LiveopsDrawResponse(
    val eventId: String,
    val ticketCost: Long,
    val riceGained: Long,
    val cosmeticTicketsGained: Long,
    /* 보석함 칸보다 먼저 저장된 result_json 에는 이 필드가 없다. 멱등 재시도가 그 행을
       그대로 역직렬화하므로 기본값을 둔다 — 없으면 옛 뽑기의 재시도가 500 으로 깨진다. */
    val gemBoxesGained: Long = 0,
    val ticketBalance: Long,
    val lines: List<LiveopsDrawLine>,
)

@Service
class LiveopsGachaService(
    private val catalog: LiveopsCatalog,
    private val repository: LiveopsRepository,
    private val accountLock: LiveopsAccountLock,
    private val prizes: LiveopsPrizeService,
    private val rice: LiveopsRiceCredit,
    private val cosmeticTickets: LiveopsCosmeticTicketCredit,
    private val gemBoxes: LiveopsGemBoxCredit,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    @Transactional
    fun draw(accountId: UUID, eventId: String, count: Int, commandId: UUID): LiveopsDrawResponse {
        require(count == 1 || count == 10) { "INVALID_DRAW_COUNT" }
        val content = catalog.require(eventId)
        require(!repository.isHalted(eventId)) { "LIVEOPS_EVENT_HALTED" }

        /* 멱등이 먼저다. 저장된 결과가 있으면 잠금 없이 그대로 돌려준다. 이것이 흔한 경로를
           싸게 만드는 지점이라 잠금 앞에 그대로 둔다. */
        repository.findDrawResult(eventId, accountId, commandId)?.let { return mapper.readValue(it, LiveopsDrawResponse::class.java) }

        /* 계정 잠금이 가장 먼저다. 저장소 전체의 잠금 순서(account → liveops 행 → wallet)를
           지켜야 한다 — 하트비트 적립 경로(GameSessionService → TicketAccrualService)는
           account 를 먼저 잠그고 liveops_ticket_balance 를 나중에 잠근다. 여기서 순서를
           뒤집으면 두 트랜잭션이 서로의 잠금을 기다리는 교착이 생긴다. */
        accountLock.lock(accountId)

        val balance = repository.lockTicketBalance(eventId, accountId)

        /* 잠금을 다 쥔 뒤 한 번 더 본다. 같은 commandId 가 동시에 들어오면 먼저 들어온 쪽이
           account 잠금을 쥔 채 끝까지 커밋할 때까지 뒤에 온 쪽이 여기서 기다린다 — 기다렸다가
           깨어나면 그 결과가 이미 저장돼 있으므로 그대로 돌려준다. 이 재확인이 없으면 뒤에 온
           쪽이 다시 추첨을 시도하다가 saveDraw 의 유니크 제약을 위반해 500 을 낸다. */
        repository.findDrawResult(eventId, accountId, commandId)?.let { return mapper.readValue(it, LiveopsDrawResponse::class.java) }

        require(balance >= count) { "INSUFFICIENT_EVENT_TICKETS" }

        /* 보석함은 가방 칸을 쓴다. 티켓을 쓰기 전에 이번 뽑기가 줄 수 있는 최대치만큼 여유를
           확인하고, 모자라면 INVENTORY_CAPACITY_EXCEEDED 로 거부한다. 굴림 뒤에 확인하면
           보석함이 안 나온 뽑기까지 되돌리게 되고, 되돌린 회차가 티켓만 쓴 것처럼 보인다.
           계정 잠금 뒤라 여유를 확인한 값이 지급 시점까지 유지된다. */
        val gemBoxWorstCase = content.maxGemBoxesPerDraw * count
        if (gemBoxWorstCase > 0) gemBoxes.preflight(accountId, gemBoxWorstCase)

        val now = clock.instant()
        val drawId = UUID.randomUUID()
        /* seed 를 drawId 에서 뽑는다. drawId 는 결과와 함께 저장되므로 나중에 같은 결과를
           다시 계산해 감사할 수 있다. */
        val random = Random(drawId.mostSignificantBits xor drawId.leastSignificantBits)
        val table = LiveopsDrawTable(content)
        val prizeOutcome = content.outcomes.firstOrNull { it.kind == LiveopsOutcomeKind.PRIZE }

        val lines = mutableListOf<LiveopsDrawLine>()
        var riceGained = 0L
        var ticketsGained = 0L
        var gemBoxesGained = 0L

        repeat(count) {
            /* 회차마다 다시 본다. 시작 시점에 한 번만 검사하면 10연차 안에서 두 번 당첨된다. */
            val grantable = prizeOutcome != null && prizes.isGrantable(content, requireNotNull(prizeOutcome.prizeId), accountId, now)
            when (val result = table.roll(random, grantable)) {
                is LiveopsDrawResult.Prize -> {
                    prizes.award(content, result.prizeId, accountId, drawId, now)
                    lines += LiveopsDrawLine("PRIZE", result.prizeId, content.prizeOf(result.prizeId).displayName, 1)
                }
                is LiveopsDrawResult.CosmeticTicket -> {
                    ticketsGained += result.quantity
                    lines += LiveopsDrawLine("COSMETIC_TICKET", null, null, result.quantity)
                }
                is LiveopsDrawResult.GemBox -> {
                    gemBoxesGained += result.quantity
                    lines += LiveopsDrawLine("GEM_BOX", null, null, result.quantity)
                }
                is LiveopsDrawResult.Rice -> {
                    riceGained += result.quantity
                    lines += LiveopsDrawLine("RICE", null, null, result.quantity)
                }
            }
        }

        /* 지급은 종류별로 한 번씩 합쳐서 한다. 열 줄을 따로 올리면 지갑 행을 열 번 잠근다. */
        if (riceGained > 0) rice.credit(accountId, riceGained, drawId)
        if (ticketsGained > 0) cosmeticTickets.credit(accountId, ticketsGained)
        if (gemBoxesGained > 0) gemBoxes.credit(accountId, gemBoxesGained)
        repository.debitTickets(eventId, accountId, count.toLong())

        val response = LiveopsDrawResponse(
            eventId = eventId,
            ticketCost = count.toLong(),
            riceGained = riceGained,
            cosmeticTicketsGained = ticketsGained,
            gemBoxesGained = gemBoxesGained,
            ticketBalance = repository.ticketBalance(eventId, accountId),
            lines = lines,
        )
        repository.saveDraw(drawId, eventId, accountId, commandId, content.contentVersion, mapper.writeValueAsString(response), now)
        return response
    }
}
