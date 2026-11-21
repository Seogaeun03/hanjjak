package com.hanjjak.gameapi

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.sql.DriverManager
import java.util.UUID

class CosmeticMixedAccountRemapMigrationTest {
    private lateinit var schema: String

    @BeforeEach
    fun prepareSchemaBeforeRepair() {
        schema = "migration_${UUID.randomUUID().toString().replace("-", "")}"
        flyway("70").migrate()
    }

    @Test
    fun `repairs an exact mixed account and restores the missed first registration`() {
        val account = account()
        skipped(account)
        state(account, "cosmetic-025", registered = 2, unregistered = 1)
        equipment(account, "HEAD", "cosmetic-025")
        draw(account, "cosmetics-v6-angel-yakgwa-back", "cosmetic-025", "cosmetic-025")
        draw(account, "cosmetics-v7-art-overhaul", "cosmetic-025")

        val versionBefore = scalar("select state_version from account where id='$account'")
        flyway("71").migrate()

        assertState(account, "cosmetic-024", registered = 2, unregistered = 0)
        assertState(account, "cosmetic-025", registered = 1, unregistered = 0)
        assertEquals("cosmetic-024", text("select cosmetic_id from cosmetic_equipment where account_id='$account' and slot='HEAD'"))
        assertEquals(0, scalar("select count(*) from cosmetic_remap_skipped_accounts where account_id='$account'"))
        assertEquals("APPLIED", text("select status from cosmetic_remap_v71_result where account_id='$account'"))
        assertEquals(1, scalar("select affected_draw_quantity from cosmetic_remap_v71_result where account_id='$account'"))
        assertEquals(1, scalar("select recommended_ticket_quantity from cosmetic_remap_v71_result where account_id='$account'"))
        assertEquals(versionBefore + 1, scalar("select state_version from account where id='$account'"))
        assertEquals(1, scalar("select count(*) from cosmetic_collection_state_v71_mixed_backup where account_id='$account' and cosmetic_id='cosmetic-025'"))
        assertEquals(2, scalar("select count(*) from cosmetic_collection_state_v71_target where account_id='$account'"))
    }

    @Test
    fun `keeps the whole account untouched when a quantity is not explained by draw audit`() {
        val account = account()
        skipped(account)
        state(account, "cosmetic-063", registered = 1, unregistered = 1)
        draw(account, "cosmetics-v6-angel-yakgwa-back", "cosmetic-063")

        val versionBefore = scalar("select state_version from account where id='$account'")
        flyway("71").migrate()

        assertState(account, "cosmetic-063", registered = 1, unregistered = 1)
        assertEquals(1, scalar("select count(*) from cosmetic_remap_skipped_accounts where account_id='$account'"))
        assertEquals("REQUIRES_MANUAL_REVIEW", text("select status from cosmetic_remap_v71_result where account_id='$account'"))
        assertEquals("QUANTITY_MISMATCH", text("select reason from cosmetic_remap_v71_result where account_id='$account'"))
        assertEquals(0, scalar("select recommended_ticket_quantity from cosmetic_remap_v71_result where account_id='$account'"))
        assertEquals(versionBefore, scalar("select state_version from account where id='$account'"))
        assertEquals(0, scalar("select count(*) from cosmetic_collection_state_v71_target where account_id='$account'"))
    }

    @Test
    fun `keeps reserved or unknown-version accounts for manual review`() {
        val reserved = account()
        skipped(reserved)
        state(reserved, "cosmetic-025", registered = 1, unregistered = 1, reserved = 1)
        draw(reserved, "cosmetics-v6-angel-yakgwa-back", "cosmetic-025")
        draw(reserved, "cosmetics-v8-legendary-banners", "cosmetic-025")

        val unknown = account()
        skipped(unknown)
        state(unknown, "cosmetic-025", registered = 1, unregistered = 0)
        draw(unknown, "cosmetics-v9-unknown", "cosmetic-025")

        flyway("71").migrate()

        assertEquals("RESERVED_QUANTITY_PRESENT", text("select reason from cosmetic_remap_v71_result where account_id='$reserved'"))
        assertEquals("UNKNOWN_CONTENT_VERSION", text("select reason from cosmetic_remap_v71_result where account_id='$unknown'"))
        assertEquals(2, scalar("select count(*) from cosmetic_remap_skipped_accounts where account_id in ('$reserved','$unknown')"))
    }

    @Test
    fun `keeps accounts with missing or malformed audit evidence and ambiguous equipment`() {
        val missingAudit = account()
        skipped(missingAudit)
        state(missingAudit, "cosmetic-025", registered = 1, unregistered = 0)

        val malformedAudit = account()
        skipped(malformedAudit)
        state(malformedAudit, "cosmetic-025", registered = 1, unregistered = 0)
        sql(
            """
            insert into cosmetic_audit_event(event_id,account_id,idempotency_key,operation,content_version,request_fingerprint,result_json,details_json)
            values ('${UUID.randomUUID()}','$malformedAudit','${UUID.randomUUID()}','DRAW','cosmetics-v6-angel-yakgwa-back','test','{}'::jsonb,'{}'::jsonb)
            """.trimIndent(),
        )

        val ambiguousEquipment = account()
        skipped(ambiguousEquipment)
        state(ambiguousEquipment, "cosmetic-025", registered = 1, unregistered = 0)
        equipment(ambiguousEquipment, "BOTTOM", "cosmetic-025")
        draw(ambiguousEquipment, "cosmetics-v6-angel-yakgwa-back", "cosmetic-025")

        flyway("71").migrate()

        assertEquals("DRAW_AUDIT_MISSING", text("select reason from cosmetic_remap_v71_result where account_id='$missingAudit'"))
        assertEquals("MALFORMED_DRAW_AUDIT", text("select reason from cosmetic_remap_v71_result where account_id='$malformedAudit'"))
        assertEquals("EQUIPMENT_SLOT_MISMATCH", text("select reason from cosmetic_remap_v71_result where account_id='$ambiguousEquipment'"))
        assertEquals(3, scalar("select count(*) from cosmetic_remap_skipped_accounts where account_id in ('$missingAudit','$malformedAudit','$ambiguousEquipment')"))
    }

    private fun flyway(target: String): Flyway = Flyway.configure().configuration(mapOf("flyway.postgresql.transactional.lock" to "false"))
        .dataSource(database.jdbcUrl, database.username, database.password)
        .schemas(schema).defaultSchema(schema).locations("classpath:db/migration").target(target).load()

    private fun account(): UUID = UUID.randomUUID().also { id ->
        sql("insert into account(id,email,password_hash,state_version,created_at) values ('$id','$id@test.local','test',1,now())")
    }

    private fun skipped(account: UUID) = sql("insert into cosmetic_remap_skipped_accounts(account_id,recorded_at) values ('$account',now())")
    private fun state(account: UUID, cosmeticId: String, registered: Int, unregistered: Int, reserved: Int = 0) = sql("insert into cosmetic_collection_state(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity) values ('$account','$cosmeticId',$registered,$unregistered,$reserved)")
    private fun equipment(account: UUID, slot: String, cosmeticId: String) = sql("insert into cosmetic_equipment(account_id,slot,cosmetic_id) values ('$account','$slot','$cosmeticId')")

    private fun draw(account: UUID, contentVersion: String, vararg cosmeticIds: String) {
        val results = cosmeticIds.joinToString(",") { "{\"cosmeticId\":\"$it\",\"grade\":\"NORMAL\",\"isNew\":false}" }
        sql(
            """
            insert into cosmetic_audit_event(event_id,account_id,idempotency_key,operation,content_version,request_fingerprint,result_json,details_json)
            values ('${UUID.randomUUID()}','$account','${UUID.randomUUID()}','DRAW','$contentVersion','test',
                    '{"data":{"results":[$results]}}'::jsonb,
                    '{"results":[$results]}'::jsonb)
            """.trimIndent(),
        )
    }

    private fun assertState(account: UUID, cosmeticId: String, registered: Int, unregistered: Int) {
        assertEquals(registered.toLong(), scalar("select registered_quantity from cosmetic_collection_state where account_id='$account' and cosmetic_id='$cosmeticId'"))
        assertEquals(unregistered.toLong(), scalar("select unregistered_quantity from cosmetic_collection_state where account_id='$account' and cosmetic_id='$cosmeticId'"))
    }

    private fun sql(statement: String) {
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use { it.execute("set search_path to $schema"); it.execute(statement) }
        }
    }

    private fun scalar(statement: String): Long = DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
        connection.createStatement().use { it.execute("set search_path to $schema"); it.executeQuery(statement).use { result -> check(result.next()); result.getLong(1) } }
    }

    private fun text(statement: String): String = DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
        connection.createStatement().use { it.execute("set search_path to $schema"); it.executeQuery(statement).use { result -> check(result.next()); result.getString(1) } }
    }

    companion object {
        private val database = PostgresTestDatabase.connection
    }
}
