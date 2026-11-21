package com.hanjjak.gems.domain

/**
 * 던전 보상표. 서버와 화면이 같은 값을 쓰도록 공식을 여기 한 곳에만 둔다.
 *
 * 예전에는 `9 + stage` 가 서비스 두 곳과 웹 화면에 각각 적혀 있었다.
 */
object GemDungeonRewards {
    /** 보상 공식의 정의역. 실제 노출 단계는 로드된 콘텐츠의 `GemDungeonCatalog.maxStage` 가 정한다. */
    const val MAX_STAGE: Int = 30

    /**
     * 최초 클리어 보석함. 1~10 구간은 승격 전 `9 + stage` 를 그대로 물려받고, 11단계부터
     * 구간마다 기울기를 올린다. 후반 한 단계가 몇 주씩 걸리는데 보상이 선형이면 보상감이 죽는다.
     *
     * 26~30 은 절대 상한 빌드로도 도달할 수 없지만, 표시상 끊기면 안 되므로 같은 기울기를 잇는다.
     */
    fun firstClear(stage: Int): Long {
        require(stage in 1..MAX_STAGE) { "INVALID_GEM_DUNGEON_STAGE" }
        return when {
            stage <= 10 -> 9L + stage
            stage <= 18 -> 19L + 3L * (stage - 10)
            stage <= 25 -> 43L + 6L * (stage - 18)
            else -> 85L + 6L * (stage - 25)
        }
    }

    /**
     * 소탕 입장권 한 장당 보석함.
     *
     * 최초 클리어와 **같은 공식을 쓰지 않는다.** 소탕은 반복 수급이라 단가가 곧 7레벨 보석
     * 도달 시간이고, 그 시간이 다시 단계 간격을 정한다. 계단식을 그대로 물리면 상한 단계에서
     * 25개/장이 되어 세 프리셋 7레벨 세트가 27일에 끝난다.
     *
     * 승격 전 선형 공식을 그대로 유지한다. `apps/balance-lab` 의 `dungeonLadder` 로 확인한
     * 결과 이 단가에서 7레벨 세트가 19단계(약 63일)에 닿아, 20단계 상한이 요구하는 자리와
     * 맞는다. 바꿀 이유가 없어 한 바퀴에 수렴했다.
     *
     * 이 값을 건드리면 보석 수급이 달라져 사다리가 움직이고 보스 수치를 다시 뽑아야 한다.
     */
    fun sweepPerTicket(stage: Int): Long {
        require(stage in 1..MAX_STAGE) { "INVALID_GEM_DUNGEON_STAGE" }
        return (9L + stage) * 3L / 10L
    }
}
