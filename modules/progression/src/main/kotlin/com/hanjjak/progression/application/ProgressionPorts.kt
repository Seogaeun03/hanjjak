package com.hanjjak.progression.application

import com.hanjjak.progression.domain.CharacterProgression
import java.util.UUID

interface ProgressionRepository {
    data class StoredCommand(val fingerprint: String, val resultJson: String)

    fun lockAccount(accountId: UUID)

    /** 화면 조회용. 행을 잠그지 않으므로 보상 지급 중인 계정도 기다리지 않고 읽는다. */
    fun progression(accountId: UUID): CharacterProgression

    /** 보상 지급용. [lockAccount]로 계정 행을 잡은 뒤 읽고 쓰는 값을 같은 트랜잭션에 고정한다. */
    fun progressionForUpdate(accountId: UUID): CharacterProgression

    fun saveProgression(accountId: UUID, progression: CharacterProgression)
    fun command(accountId: UUID, idempotencyKey: UUID): StoredCommand?
    fun saveCommand(accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String)
}
