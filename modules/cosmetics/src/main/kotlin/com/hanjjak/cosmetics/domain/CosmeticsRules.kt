package com.hanjjak.cosmetics.domain

object CosmeticsRules {
    fun star(registeredQuantity: Int, thresholds: List<Int>): Int = thresholds.indexOfLast { registeredQuantity >= it } + 1

    fun canUpgrade(state: CosmeticState, thresholds: List<Int>): Boolean {
        val currentStar = star(state.registeredQuantity, thresholds)
        if (currentStar <= 0 || currentStar >= thresholds.size) return false
        return state.availableUnregisteredQuantity >= thresholds[currentStar] - state.registeredQuantity
    }

    fun register(state: CosmeticState, mode: RegistrationMode, thresholds: List<Int>): CosmeticState {
        val currentStar = star(state.registeredQuantity, thresholds)
        require(currentStar < thresholds.size) { "COSMETIC_MAX_STAR" }
        val quantity = when (mode) {
            RegistrationMode.ONE -> 1
            RegistrationMode.UNTIL_NEXT_STAR -> thresholds[currentStar] - state.registeredQuantity
        }
        require(state.availableUnregisteredQuantity >= quantity) { "INSUFFICIENT_UNREGISTERED_COSMETICS" }
        return state.copy(registeredQuantity = state.registeredQuantity + quantity, unregisteredQuantity = state.unregisteredQuantity - quantity)
    }

    fun snapshot(states: List<CosmeticState>, equipment: List<EquipmentSlot>, content: CosmeticsContent, color: String? = null): CollectionSnapshot {
        val byId = states.associateBy { it.cosmeticId }
        val byDefinition = content.cosmetics.associateBy { it.id }
        val setStars = content.sets.associate { set ->
            set.id to set.members.values.minOf { memberId ->
                val definition = byDefinition.getValue(memberId)
                star(byId[memberId]?.registeredQuantity ?: 0, content.starThresholdsByGrade.getValue(definition.grade))
            }
        }
        val setEffects = content.sets.associate { set -> set.id to (set.effects[setStars.getValue(set.id)] ?: emptyList()) }
        val totalEffects = setEffects.values.flatten()
            .groupBy { it.statId to it.unit }
            .map { (key, rows) -> StatEffect(key.first, rows.sumOf { it.value }, key.second) }
            .sortedWith(compareBy(StatEffect::statId, { it.unit.name }))
        val views = content.cosmetics.map { definition ->
            val state = byId[definition.id] ?: CosmeticState(states.firstOrNull()?.accountId ?: java.util.UUID(0, 0), definition.id, 0, 0, 0)
            val thresholds = content.starThresholdsByGrade.getValue(definition.grade)
            val currentStar = star(state.registeredQuantity, thresholds)
            val nextThreshold = thresholds.getOrNull(currentStar)
            val needed = nextThreshold?.minus(state.registeredQuantity)
            val disabledReason = when {
                state.registeredQuantity == 0 -> "NOT_OWNED"
                needed == null -> "MAX_STAR"
                state.availableUnregisteredQuantity < needed -> "INSUFFICIENT_DUPLICATES"
                else -> null
            }
            CosmeticView(definition.id, definition.displayName, definition.imageUrl, definition.grade, definition.slot, state.registeredQuantity, state.unregisteredQuantity, state.reservedQuantity, state.availableUnregisteredQuantity, currentStar, nextThreshold, needed, disabledReason == null, disabledReason)
        }
        return CollectionSnapshot(
            views,
            // 게임에서 내린 세트를 차고 있던 칸은 빈 칸으로 돌려준다. 소유 기록은 DB에 그대로 남아
            // 다시 넣으면 살아나지만, 목록에 없는 치장을 착용 중이라고 알리면 화면이 그 칸을 그리지 못한다.
            CosmeticSlot.entries.associateWith { slot -> equipment.firstOrNull { it.slot == slot }?.cosmeticId?.takeIf { it in byDefinition } },
            // 콘텐츠에서 사라진 색을 들고 있으면 화면이 없는 폴더를 찾는다. 모르는 색은 비운다.
            color?.takeIf { chosen -> content.sets.any { chosen in it.colors } },
            states.count { it.registeredQuantity >= 1 && it.cosmeticId in byDefinition },
            setStars,
            setEffects,
            totalEffects,
            content.version,
        )
    }

    fun receive(state: CosmeticState?, accountId: java.util.UUID, cosmeticId: String): Pair<CosmeticState, Boolean> =
        receive(state, accountId, cosmeticId, 1, allowDuplicates = true)

    /**
     * 한 획득 경로가 같은 치장을 여러 개 지급해도 첫 한 개는 즉시 등록하고 나머지만 중복
     * 재고로 둔다. 세트 밖 단품은 계정당 한 번뿐이라 수량 지급과 재지급을 모두 거절한다.
     */
    fun receive(
        state: CosmeticState?,
        accountId: java.util.UUID,
        cosmeticId: String,
        quantity: Int,
        allowDuplicates: Boolean,
    ): Pair<CosmeticState, Boolean> {
        require(quantity > 0) { "INVALID_QUANTITY" }
        require(allowDuplicates || (state == null && quantity == 1)) { "COSMETIC_ALREADY_OWNED" }
        return if (state == null) {
            CosmeticState(accountId, cosmeticId, 1, quantity - 1, 0) to true
        } else {
            state.copy(unregisteredQuantity = Math.addExact(state.unregisteredQuantity, quantity)) to false
        }
    }
}
