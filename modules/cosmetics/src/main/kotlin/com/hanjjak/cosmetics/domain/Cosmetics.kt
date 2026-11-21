package com.hanjjak.cosmetics.domain

import com.fasterxml.jackson.annotation.JsonInclude
import java.util.UUID

enum class CosmeticGrade { NORMAL, RARE, EPIC, LEGENDARY }
// 얼굴은 볼터치·눈·안경이 한 자리를 두고 다툰다. 셋 중 하나만 낄 수 있다.
enum class CosmeticSlot { HEAD, FACE, TOP, BOTTOM, GLOVES, SHOES, CAPE }
enum class RegistrationMode { ONE, UNTIL_NEXT_STAR }
enum class EffectUnit { BASIS_POINTS, PERCENTAGE_POINTS, SECONDS }

data class StatEffect(val statId: String, val value: Int, val unit: EffectUnit)
// setId가 비면 세트에 속하지 않는 치장이다. 도감에 뜨지 않고 세트 효과도 없다.
data class CosmeticDefinition(
    val id: String,
    val displayName: String?,
    val imageUrl: String?,
    val grade: CosmeticGrade,
    val slot: CosmeticSlot,
    val setId: String?,
    /** false면 이벤트·운영 지급만 허용하고 공용 뽑기 풀에서는 뺈다. */
    val gachaEligible: Boolean = true,
)
data class SetDefinition(
    val id: String,
    val displayName: String?,
    val grade: CosmeticGrade,
    val bannerId: String?,
    val boxItemId: String?,
    val members: Map<CosmeticSlot, String>,
    val effects: Map<Int, List<StatEffect>>,
    /** 색만 다른 세트가 고를 수 있는 색. 값이 그대로 아트 폴더 꼬리표가 된다. */
    val colors: List<String> = emptyList(),
)
data class CosmeticsContent(
    val version: String,
    val singleRiceCost: Long,
    val gradeProbabilities: Map<CosmeticGrade, Int>,
    val starThresholdsByGrade: Map<CosmeticGrade, List<Int>>,
    val cosmetics: List<CosmeticDefinition>,
    val sets: List<SetDefinition>,
)
data class CosmeticState(
    val accountId: UUID,
    val cosmeticId: String,
    val registeredQuantity: Int,
    val unregisteredQuantity: Int,
    val reservedQuantity: Int,
) {
    val availableUnregisteredQuantity: Int get() = unregisteredQuantity - reservedQuantity
    init {
        require(registeredQuantity >= 0 && unregisteredQuantity >= 0 && reservedQuantity >= 0)
        require(availableUnregisteredQuantity >= 0)
    }
}
data class EquipmentSlot(val accountId: UUID, val slot: CosmeticSlot, val cosmeticId: String?)

@JsonInclude(JsonInclude.Include.ALWAYS)
data class CosmeticView(
    val cosmeticId: String,
    val displayName: String?,
    val imageUrl: String?,
    val grade: CosmeticGrade,
    val slot: CosmeticSlot,
    val registeredQuantity: Int,
    val unregisteredQuantity: Int,
    val reservedQuantity: Int,
    val availableUnregisteredQuantity: Int,
    val cosmeticStar: Int,
    val nextStarThreshold: Int?,
    val neededForNextStar: Int?,
    val canUpgrade: Boolean = false,
    val upgradeDisabledReason: String? = "REFRESH_REQUIRED",
)

data class CollectionSnapshot(
    val states: List<CosmeticView>,
    val equipment: Map<CosmeticSlot, String?>,
    /** 색만 다른 세트에서 고른 색. 고르지 않았으면 비어 있고, 화면은 첫 번째 색을 쓴다. */
    val color: String?,
    val uniqueRegisteredCount: Int,
    val setStars: Map<String, Int>,
    val setEffects: Map<String, List<StatEffect>>,
    val totalEffects: List<StatEffect>,
    val contentVersion: String,
)

data class BulkRegistrationResult(
    val upgradedCount: Int,
    val collection: CollectionSnapshot,
)

data class VersionedResult<T>(val data: T, val stateVersion: Long)

@JsonInclude(JsonInclude.Include.ALWAYS)
data class CosmeticCatalogItem(
    val cosmeticId: String,
    val displayName: String?,
    val grade: CosmeticGrade,
    val slot: CosmeticSlot,
    /** 세트에 속하지 않는 치장은 비어 있다. */
    val setId: String?,
    val imageUrl: String?,
)

@JsonInclude(JsonInclude.Include.ALWAYS)
data class CosmeticCatalogSet(
    val setId: String,
    val displayName: String?,
    val grade: CosmeticGrade,
    val members: Map<CosmeticSlot, String>,
    val effects: Map<Int, List<StatEffect>>,
    val colors: List<String>,
)

data class CosmeticsCatalog(
    val contentVersion: String,
    val cosmetics: List<CosmeticCatalogItem>,
    val sets: List<CosmeticCatalogSet>,
)
