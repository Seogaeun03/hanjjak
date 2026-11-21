package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 장비 명령 한 번으로 상태와 전투력 증가량을 함께 받는지 확인한다. 예전 웹은 같은 화면에서
 * 명령 앞뒤로 공개 순위표를 한 번씩 더 불러 계정 전체의 전투력을 다시 계산하게 만들었다.
 *
 * 관련 작업 문서는 `docs/wiki/06-delivery/tasks/K-client-ux/k-11-enhancement-equipment-sale-ui.md`.
 */
@GameApiIntegrationTest
class EquipmentCommandE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient

    @Test
    fun `enhance answers with the combat power gain in one request`() {
        val player = AccountSession().apply { signup("equipment-power-${UUID.randomUUID()}@test.local", "power") }
        player.stockGrowthResources()
        player.command("WEAPON", "unlock", UUID.randomUUID())

        val enhanced = player.command("WEAPON", "enhance", UUID.randomUUID())

        assertEquals(2, enhanced.at("/data/slot/current/enhancementLevel").asInt())
        val before = enhanced.at("/data/combatPower/before").asLong()
        val after = enhanced.at("/data/combatPower/after").asLong()
        assertTrue(before > 0, "명령 전 전투력을 읽어야 한다")
        assertTrue(after > before, "강화 뒤 전투력이 올라야 한다")
        assertEquals(after - before, enhanced.at("/data/combatPower/increase").asLong())
    }

    @Test
    fun `bulk enhance also answers with the combined combat power gain`() {
        val player = AccountSession().apply { signup("equipment-bulk-power-${UUID.randomUUID()}@test.local", "bulk-power") }
        player.stockGrowthResources()
        player.command("WEAPON", "unlock", UUID.randomUUID())

        val enhanced = player.bulkEnhance("WEAPON", 3, UUID.randomUUID())

        assertEquals(4, enhanced.at("/data/slot/current/enhancementLevel").asInt())
        val before = enhanced.at("/data/combatPower/before").asLong()
        val after = enhanced.at("/data/combatPower/after").asLong()
        assertTrue(after > before, "일괄 강화 뒤 전투력이 올라야 한다")
        assertEquals(after - before, enhanced.at("/data/combatPower/increase").asLong())
    }

    @Test
    fun `replaying the same key returns the stored result without charging again`() {
        val player = AccountSession().apply { signup("equipment-replay-${UUID.randomUUID()}@test.local", "replay") }
        player.stockGrowthResources()
        player.command("WEAPON", "unlock", UUID.randomUUID())
        val key = UUID.randomUUID()

        val first = player.command("WEAPON", "enhance", key)
        val riceAfterFirst = rice(player.accountId)
        val replay = player.command("WEAPON", "enhance", key)

        assertEquals(first.at("/data/slot"), replay.at("/data/slot"))
        assertEquals(2, replay.at("/data/slot/current/enhancementLevel").asInt())
        assertEquals(riceAfterFirst, rice(player.accountId))
        // 재생은 같은 상태를 돌려줄 뿐 성장이 없으므로 증가량도 없다.
        assertEquals(0, replay.at("/data/combatPower/increase").asLong())
    }

    /**
     * 부위 행 잠금을 없앤 뒤에도 계정 행 잠금이 같은 계정의 장비 명령을 한 줄로 세우는지 본다.
     * 둘 다 성공하면 단계는 정확히 두 칸만 오르고 비용도 두 번만 빠져야 한다.
     */
    @Test
    fun `concurrent enhancements on one slot stay serialized by the account lock`() {
        val player = AccountSession().apply { signup("equipment-race-${UUID.randomUUID()}@test.local", "race") }
        player.stockGrowthResources()
        player.command("WEAPON", "unlock", UUID.randomUUID())
        val riceBefore = rice(player.accountId)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)

        val results = try {
            val futures = (1..2).map {
                pool.submit<JsonNode> {
                    start.await()
                    player.command("WEAPON", "enhance", UUID.randomUUID())
                }
            }
            start.countDown()
            futures.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }

        assertEquals(setOf(2, 3), results.map { it.at("/data/slot/current/enhancementLevel").asInt() }.toSet())
        assertEquals(3, enhancementLevel(player.accountId))
        assertEquals(riceBefore - 30L - 60L, rice(player.accountId))
    }

    /**
     * 신화는 도메인 규칙과 콘텐츠에만 있고 DB 저장까지 거치는 검증이 없었다. 승급이 실제로 저장되고
     * 신화 1강에서 강화가 이어지는지 본다. 신규 가입은 `progression-rebalance-v1`을 받는다.
     */
    @Test
    fun `legendary max slot promotes to mythic and keeps enhancing`() {
        val player = AccountSession().apply { signup("equipment-mythic-${UUID.randomUUID()}@test.local", "mythic") }
        player.stockGrowthResources()
        player.stockAllGenerations()
        player.command("WEAPON", "unlock", UUID.randomUUID())
        jdbc.sql("update equipment_slot_state set grade='LEGENDARY',enhancement_level=30 where account_id=:account and slot='WEAPON'")
            .param("account", player.accountId).update()
        jdbc.sql(
            """insert into stage_progress(account_id,stage_id,unlocked,first_cleared_at,highest_clear_count,content_version)
               values (:account,'stage.07-10',true,now(),1,'test')
               on conflict(account_id,stage_id) do update set first_cleared_at=excluded.first_cleared_at""",
        ).param("account", player.accountId).update()

        val promoted = player.command("WEAPON", "promote", UUID.randomUUID())

        assertEquals("MYTHIC", promoted.at("/data/slot/current/grade").asText())
        assertEquals(1, promoted.at("/data/slot/current/enhancementLevel").asInt())
        assertEquals("MYTHIC", grade(player.accountId))

        val enhanced = player.command("WEAPON", "enhance", UUID.randomUUID())

        assertEquals("MYTHIC", enhanced.at("/data/slot/current/grade").asText())
        assertEquals(2, enhancementLevel(player.accountId))
    }

    private fun grade(accountId: UUID): String = jdbc.sql("select grade from equipment_slot_state where account_id=:account and slot='WEAPON'")
        .param("account", accountId).query(String::class.java).single()

    private fun rice(accountId: UUID): Long = jdbc.sql("select balance from wallet_balance where account_id=:account")
        .param("account", accountId).query(Long::class.java).single()

    private fun enhancementLevel(accountId: UUID): Int = jdbc.sql("select enhancement_level from equipment_slot_state where account_id=:account and slot='WEAPON'")
        .param("account", accountId).query(Int::class.java).single()

    private inner class AccountSession {
        lateinit var accountId: UUID
        private val cookies = mutableListOf<Cookie>()

        fun signup(email: String, nickname: String) {
            val unique = "$nickname-${UUID.randomUUID().toString().take(6)}".take(20)
            accountId = UUID.fromString(postJson("/api/v1/auth/signup", mapOf("email" to email, "password" to "password123", "nickname" to unique), UUID.randomUUID(), false).at("/data/accountId").asText())
            postJson("/api/v1/material-preference", mapOf("materialType" to "POTATO"), UUID.randomUUID())
        }

        /** 해금과 강화를 여러 번 버틸 만큼의 쌀과 1세대 재료를 넣는다. */
        fun stockGrowthResources() {
            jdbc.sql("update wallet_balance set balance=:balance where account_id=:account")
                .params(mapOf("balance" to 1_000_000L, "account" to accountId)).update()
            listOf("POTATO_M1", "SWEET_POTATO_M1", "CORN_M1").forEach { itemId ->
                jdbc.sql("insert into inventory_stack(account_id,item_id,quantity,reserved_quantity,acquired_sequence) values (:account,:item,:quantity,0,1) on conflict(account_id,item_id) do update set quantity=inventory_stack.quantity+excluded.quantity")
                    .params(mapOf("account" to accountId, "item" to itemId, "quantity" to 100_000L)).update()
            }
        }

        /** 전설 승급과 신화 강화가 요구하는 M2~M5까지 세 계열 모두 넉넉히 넣는다. */
        fun stockAllGenerations() {
            listOf("POTATO", "SWEET_POTATO", "CORN").flatMap { family -> (1..5).map { "${family}_M$it" } }.forEach { itemId ->
                jdbc.sql("insert into inventory_stack(account_id,item_id,quantity,reserved_quantity,acquired_sequence) values (:account,:item,:quantity,0,1) on conflict(account_id,item_id) do update set quantity=inventory_stack.quantity+excluded.quantity")
                    .params(mapOf("account" to accountId, "item" to itemId, "quantity" to 1_000_000L)).update()
            }
        }

        fun command(slot: String, action: String, idempotencyKey: UUID): JsonNode =
            postJson("/api/v1/equipment/$slot/$action", emptyMap<String, String>(), idempotencyKey)

        fun bulkEnhance(slot: String, count: Int, idempotencyKey: UUID): JsonNode =
            postJson("/api/v1/equipment/$slot/enhance-bulk", mapOf("count" to count), idempotencyKey)

        fun postJson(path: String, body: Any, idempotencyKey: UUID, authenticated: Boolean = true): JsonNode {
            val request = post(path).header("Idempotency-Key", idempotencyKey.toString()).header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
            synchronized(cookies) { if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray()) }
            if (authenticated) request.sessionAttr("accountId", accountId)
            val result = mvc.perform(request).andExpect(status().isOk).andReturn()
            captureCookies(result)
            return mapper.readTree(result.response.contentAsString)
        }

        private fun captureCookies(result: MvcResult) = synchronized(cookies) {
            result.response.cookies.forEach { cookie -> cookies.removeIf { it.name == cookie.name }; cookies += cookie }
        }
    }
}
