package com.hanjjak.equipment.api

import com.hanjjak.equipment.application.CombatPowerProbe
import com.hanjjak.equipment.application.EquipmentService
import com.hanjjak.equipment.domain.EquipmentCommandResult
import com.hanjjak.equipment.domain.EquipmentSlot
import com.hanjjak.equipment.domain.EquipmentSlotSummary
import com.hanjjak.equipment.domain.EquipmentState
import jakarta.servlet.http.HttpSession
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.web.bind.annotation.*
import java.time.Clock
import java.util.UUID

@RestController
@RequestMapping("/api/v1/equipment")
class EquipmentController(
    private val equipment: EquipmentService,
    private val jdbc: JdbcClient,
    private val clock: Clock,
    private val combatPowerProbe: ObjectProvider<CombatPowerProbe>,
) {
    private val log = LoggerFactory.getLogger(EquipmentController::class.java)

    data class EmptyRequest(val ignored: String? = null)
    data class BulkEnhanceRequest(val count: Int)
    data class Envelope<T>(val requestId: UUID, val serverTime: java.time.Instant, val stateVersion: Long, val data: T)

    /** 명령 한 번의 전투력 변화. 읽지 못했으면 응답에서 통째로 빠진다. */
    data class CombatPowerChange(val before: Long, val after: Long, val increase: Long)

    data class CommandResponse(
        val slot: EquipmentSlotSummary,
        val state: EquipmentState,
        val combatPower: CombatPowerChange?,
    )

    @GetMapping
    fun state(session: HttpSession): Envelope<EquipmentState> {
        val accountId = accountId(session)
        return envelope(accountId, equipment.state(accountId))
    }

    @PostMapping("/{slot}/unlock")
    fun unlock(@PathVariable slot: EquipmentSlot, @RequestHeader("Idempotency-Key") idempotencyKey: UUID, @RequestBody request: EmptyRequest = EmptyRequest(), session: HttpSession): Envelope<CommandResponse> {
        val accountId = accountId(session)
        return command(accountId) { equipment.unlock(accountId, idempotencyKey, slot) }
    }

    @PostMapping("/{slot}/enhance")
    fun enhance(@PathVariable slot: EquipmentSlot, @RequestHeader("Idempotency-Key") idempotencyKey: UUID, @RequestBody request: EmptyRequest = EmptyRequest(), session: HttpSession): Envelope<CommandResponse> {
        val accountId = accountId(session)
        return command(accountId) { equipment.enhance(accountId, idempotencyKey, slot) }
    }

    @PostMapping("/{slot}/enhance-bulk")
    fun enhanceBulk(@PathVariable slot: EquipmentSlot, @RequestHeader("Idempotency-Key") idempotencyKey: UUID, @RequestBody request: BulkEnhanceRequest, session: HttpSession): Envelope<CommandResponse> {
        val accountId = accountId(session)
        return command(accountId) { equipment.enhanceBulk(accountId, idempotencyKey, slot, request.count) }
    }

    @PostMapping("/{slot}/promote")
    fun promote(@PathVariable slot: EquipmentSlot, @RequestHeader("Idempotency-Key") idempotencyKey: UUID, @RequestBody request: EmptyRequest = EmptyRequest(), session: HttpSession): Envelope<CommandResponse> {
        val accountId = accountId(session)
        return command(accountId) { equipment.promote(accountId, idempotencyKey, slot) }
    }

    /**
     * 전투력 증가량을 명령 응답에 실어 보낸다.
     *
     * 예전에는 웹이 `전투력 조회 → 명령 → 전투력 재조회`로 세 번 다녀왔고, 그 두 번의 조회는
     * 공개 순위 읽기 모형을 계정 전체에 대해 다시 계산했다. 지금은 명령 하나만 오가고 서버가
     * 앞뒤 전투력을 계정 하나 범위로만 읽는다.
     *
     * 전투력 읽기는 명령 트랜잭션 밖에서 한다. 실패해도 이미 확정한 비용 차감과 상태 변경을
     * 되돌리지 않고, 화면 연출용 항목만 비워 보낸다.
     */
    private fun command(accountId: UUID, action: () -> EquipmentCommandResult): Envelope<CommandResponse> {
        val before = combatPower(accountId)
        val result = action()
        val after = combatPower(accountId)
        val change = if (before != null && after != null) CombatPowerChange(before, after, after - before) else null
        return envelope(accountId, CommandResponse(result.slot, result.state, change))
    }

    private fun combatPower(accountId: UUID): Long? {
        val probe = combatPowerProbe.getIfAvailable() ?: return null
        return try {
            probe.combatPower(accountId)
        } catch (error: RuntimeException) {
            log.warn("장비 명령 전투력 조회에 실패해 증가량을 생략한다. account={}", accountId, error)
            null
        }
    }

    private fun accountId(session: HttpSession): UUID = session.getAttribute("accountId") as? UUID ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")
    private fun <T> envelope(accountId: UUID, data: T): Envelope<T> = Envelope(UUID.randomUUID(), clock.instant(), stateVersion(accountId), data)
    private fun stateVersion(accountId: UUID): Long = jdbc.sql("select state_version from account where id=:account").param("account", accountId).query(Long::class.java).single()
}
