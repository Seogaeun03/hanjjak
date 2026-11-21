package com.hanjjak.equipment.application

import com.hanjjak.equipment.domain.EquipmentBattleStats
import com.hanjjak.equipment.domain.EquipmentSlot
import com.hanjjak.equipment.domain.EquipmentSlotState
import com.hanjjak.equipment.domain.MaterialCost
import java.util.UUID

interface EquipmentStatsProvider {
    fun stats(accountId: UUID): EquipmentBattleStats
}

/**
 * 한 계정의 전투력만 읽는다.
 *
 * 공개 순위 읽기 모형은 답하기 전에 모든 인물의 전투력을 다시 계산하고 갱신한다. 장비 명령
 * 한 번의 증가량을 보여주려고 그 일을 앞뒤로 두 번 시키면 명령 자체보다 훨씬 비싸진다.
 * 구현이 없으면 `null`을 돌려 명령 응답에서 전투력 항목만 빠지게 한다.
 */
fun interface CombatPowerProbe {
    fun combatPower(accountId: UUID): Long?
}

interface EquipmentRepository {
    data class StoredCommand(val fingerprint: String, val resultJson: String)

    fun lockAccount(accountId: UUID)
    fun balanceVersion(accountId: UUID): String
    fun riceBalance(accountId: UUID): Long
    fun materialBalances(accountId: UUID, itemIds: Collection<String>): Map<String, Long>
    fun slotStates(accountId: UUID): List<EquipmentSlotState>
    fun findSlotState(accountId: UUID, slot: EquipmentSlot): EquipmentSlotState?
    fun firstClearedStages(accountId: UUID, stageIds: Collection<String>): Set<String>
    fun consumeMaterials(accountId: UUID, materials: List<MaterialCost>)
    fun createSlotState(state: EquipmentSlotState)
    fun updateSlotState(state: EquipmentSlotState)
    fun incrementStateVersion(accountId: UUID): Long
    fun command(accountId: UUID, idempotencyKey: UUID): StoredCommand?
    fun saveCommand(accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String)
}
