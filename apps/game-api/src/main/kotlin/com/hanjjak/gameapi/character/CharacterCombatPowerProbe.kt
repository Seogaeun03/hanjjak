package com.hanjjak.gameapi.character

import com.hanjjak.equipment.application.CombatPowerProbe
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 장비 명령이 쓰는 전투력 조회다. 공개 순위 읽기 모형을 건드리지 않고 이 계정의 인물 지표만
 * 계산한다. 순위표 갱신은 `GET /api/v1/ranking/combat-power`가 그대로 소유한다.
 */
@Component
class CharacterCombatPowerProbe(private val characterStats: CharacterStatsService) : CombatPowerProbe {
    override fun combatPower(accountId: UUID): Long = characterStats.snapshot(accountId).view.combatPower
}
