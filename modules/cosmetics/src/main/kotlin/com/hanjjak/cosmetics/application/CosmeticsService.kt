package com.hanjjak.cosmetics.application

import com.hanjjak.cosmetics.domain.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.annotation.Isolation
import java.util.UUID

@Service
class CosmeticsService(private val repository: CosmeticsRepository, private val content: CosmeticsContent, private val wallet: CosmeticsWallet) {
    @Transactional(isolation = Isolation.REPEATABLE_READ)
    fun collection(accountId: UUID): CollectionSnapshot {
        requireUnlocked(accountId)
        return snapshotForCombat(accountId)
    }

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    fun versionedCollection(accountId: UUID): VersionedResult<CollectionSnapshot> =
        VersionedResult(collection(accountId), repository.stateVersion(accountId))

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    fun catalog(accountId: UUID): VersionedResult<CosmeticsCatalog> {
        // The catalog is public display metadata. Ranking needs it to render another
        // player's equipped cosmetics even when the viewer has not unlocked the
        // cosmetics feature yet. Collection and every mutation remain gated below.
        return VersionedResult(CosmeticsCatalog(content.version,
            content.cosmetics.map { CosmeticCatalogItem(it.id, it.displayName, it.grade, it.slot, it.setId, it.imageUrl) },
            content.sets.map { CosmeticCatalogSet(it.id, it.displayName, it.grade, it.members, it.effects, it.colors) }), repository.stateVersion(accountId))
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun snapshotForCombat(accountId: UUID): CollectionSnapshot =
        CosmeticsRules.snapshot(repository.findStates(accountId), repository.findEquipment(accountId), content, repository.findColor(accountId))

    /**
     * 색만 다른 세트에서 색을 고른다. 스탯에는 영향이 없지만 남이 보는 내 모습에도 같은 색이
     * 나와야 해서 서버가 들고 있는다. 콘텐츠가 내놓은 색만 받는다.
     */
    @Transactional
    fun chooseColor(accountId: UUID, color: String?): CollectionSnapshot {
        repository.lockAccount(accountId)
        requireUnlockedForUpdate(accountId)
        require(color == null || content.sets.any { color in it.colors }) { "COSMETIC_COLOR_UNKNOWN" }
        repository.saveColor(accountId, color)
        return collection(accountId)
    }

    @Transactional
    fun register(accountId: UUID, cosmeticId: String, mode: RegistrationMode): CollectionSnapshot {
        repository.lockAccount(accountId)
        requireUnlockedForUpdate(accountId)
        val definition = requireDefinition(cosmeticId)
        val state = repository.findStateForUpdate(accountId, cosmeticId) ?: throw IllegalArgumentException("COSMETIC_NOT_OWNED")
        repository.saveState(CosmeticsRules.register(state, mode, content.starThresholdsByGrade.getValue(definition.grade)))
        return collection(accountId)
    }

    @Transactional
    fun bulkRegisterUntilNextStar(accountId: UUID): BulkRegistrationResult {
        repository.lockAccount(accountId)
        requireUnlockedForUpdate(accountId)
        val definitions = content.cosmetics.associateBy { it.id }
        val upgraded = repository.findStatesForUpdate(accountId).mapNotNull { state ->
            val definition = definitions[state.cosmeticId] ?: return@mapNotNull null
            val thresholds = content.starThresholdsByGrade.getValue(definition.grade)
            if (!CosmeticsRules.canUpgrade(state, thresholds)) return@mapNotNull null
            CosmeticsRules.register(state, RegistrationMode.UNTIL_NEXT_STAR, thresholds)
        }
        upgraded.forEach(repository::saveState)
        return BulkRegistrationResult(upgraded.size, collection(accountId))
    }

    @Transactional
    fun equip(accountId: UUID, slot: CosmeticSlot, cosmeticId: String?): CollectionSnapshot {
        repository.lockAccount(accountId)
        requireUnlockedForUpdate(accountId)
        if (cosmeticId != null) {
            val definition = requireDefinition(cosmeticId)
            require(definition.slot == slot) { "COSMETIC_SLOT_MISMATCH" }
            val state = repository.findStateForUpdate(accountId, cosmeticId) ?: throw IllegalArgumentException("COSMETIC_NOT_OWNED")
            require(state.registeredQuantity >= 1) { "COSMETIC_NOT_OWNED" }
        }
        repository.saveEquipment(accountId, slot, cosmeticId)
        return collection(accountId)
    }

    @Transactional
    fun receive(accountId: UUID, cosmeticId: String): Pair<CollectionSnapshot, Boolean> {
        repository.lockAccount(accountId)
        requireUnlockedForUpdate(accountId)
        val definition = requireDefinition(cosmeticId)
        val current = repository.findStateForUpdate(accountId, cosmeticId)
        require(definition.setId != null || current == null) { "COSMETIC_ALREADY_OWNED" }
        val (state, isNew) = CosmeticsRules.receive(current, accountId, cosmeticId)
        repository.saveState(state)
        return collection(accountId) to isNew
    }

    fun content(): CosmeticsContent = content

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun totalEffects(accountId: UUID): List<StatEffect> = snapshotForCombat(accountId).totalEffects
    /** 조회 경로용 해금 확인. 잠금 없는 잔액 조회만 사용한다. */
    fun requireUnlocked(accountId: UUID) {
        require(wallet.balance(accountId).unlocked) { "COSMETICS_LOCKED" }
    }

    /**
     * 변경 경로용 해금 확인. 호출자가 이미 계정 행을 잠근 뒤에 부르고, 해금과 티켓 지급이
     * 같은 트랜잭션에서 일어나는 stage.01-05 첫 클리어와 겹쳐도 확정된 값만 읽는다.
     */
    fun requireUnlockedForUpdate(accountId: UUID) {
        require(wallet.balanceForUpdate(accountId).unlocked) { "COSMETICS_LOCKED" }
    }
    private fun requireDefinition(cosmeticId: String): CosmeticDefinition = content.cosmetics.firstOrNull { it.id == cosmeticId }
        ?: throw IllegalArgumentException("COSMETIC_NOT_FOUND")
}
