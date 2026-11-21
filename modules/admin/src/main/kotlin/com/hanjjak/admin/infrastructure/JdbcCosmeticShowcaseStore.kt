package com.hanjjak.admin.infrastructure

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.CosmeticShowcaseStore
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

@Repository
class JdbcCosmeticShowcaseStore(
    private val jdbc: JdbcClient,
    private val mapper: ObjectMapper,
) : CosmeticShowcaseStore {
    override fun load(): CosmeticShowcaseStore.State {
        // 통합 시험은 업무 데이터를 비우며, 운영에서도 단일 설정 행의 우발 삭제가 조회 장애로
        // 번지지 않게 기본값을 멱등하게 복구한다. 기존 행이 있으면 아무것도 바꾸지 않는다.
        jdbc.sql(
            """
            insert into cosmetic_gacha_showcase_config(config_id,selected_set_ids,version,updated_by,updated_at,reason)
            values (1,'["sushi","mage","cotton-painter","moon-rabbit","white-fox-spirit","magical-girl"]'::jsonb,1,null,now(),'기본 치장 뽑기 소개 세트')
            on conflict (config_id) do nothing
            """.trimIndent(),
        ).update()
        return jdbc.sql(
            "select selected_set_ids, version, updated_at from cosmetic_gacha_showcase_config where config_id=1",
        ).query { row, _ ->
            CosmeticShowcaseStore.State(
                mapper.readValue(row.getString("selected_set_ids"), object : TypeReference<List<String>>() {}),
                row.getLong("version"),
                row.getTimestamp("updated_at").toInstant(),
            )
        }.single()
    }

    override fun update(
        expectedVersion: Long,
        selectedSetIds: List<String>,
        operatorId: UUID,
        reason: String,
        updatedAt: Instant,
    ): Boolean = jdbc.sql(
        """
        update cosmetic_gacha_showcase_config
        set selected_set_ids=cast(:selected as jsonb), version=version+1,
            updated_by=:operator, updated_at=:updatedAt, reason=:reason
        where config_id=1 and version=:expectedVersion
        """.trimIndent(),
    ).params(
        mapOf(
            "selected" to mapper.writeValueAsString(selectedSetIds),
            "operator" to operatorId,
            "updatedAt" to Timestamp.from(updatedAt),
            "reason" to reason,
            "expectedVersion" to expectedVersion,
        ),
    ).update() == 1

    override fun findCommand(operatorId: UUID, idempotencyKey: UUID): CosmeticShowcaseStore.StoredCommand? =
        jdbc.sql(
            "select fingerprint,result_json from admin_cosmetic_showcase_command where operator_id=:operator and idempotency_key=:key",
        ).params(mapOf("operator" to operatorId, "key" to idempotencyKey))
            .query { row, _ -> CosmeticShowcaseStore.StoredCommand(row.getString("fingerprint"), row.getString("result_json")) }
            .optional().orElse(null)

    override fun saveCommand(
        operatorId: UUID,
        idempotencyKey: UUID,
        fingerprint: String,
        resultJson: String,
        createdAt: Instant,
    ) {
        jdbc.sql(
            """
            insert into admin_cosmetic_showcase_command(operator_id,idempotency_key,fingerprint,result_json,created_at)
            values (:operator,:key,:fingerprint,cast(:result as jsonb),:createdAt)
            """.trimIndent(),
        ).params(
            mapOf(
                "operator" to operatorId,
                "key" to idempotencyKey,
                "fingerprint" to fingerprint,
                "result" to resultJson,
                "createdAt" to Timestamp.from(createdAt),
            ),
        ).update()
    }
}
