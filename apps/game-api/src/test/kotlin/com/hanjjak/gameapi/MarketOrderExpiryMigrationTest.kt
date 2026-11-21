package com.hanjjak.gameapi

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.sql.DriverManager
import java.time.Instant
import java.time.OffsetDateTime
import java.util.UUID

class MarketOrderExpiryMigrationTest {
    @Test
    fun `migration adds 16 hours only to existing active sell GTC orders`() {
        val database = PostgresTestDatabase.connection
        val schema = "market_expiry_${UUID.randomUUID().toString().replace("-", "")}"
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use { it.execute("create schema $schema") }
        }
        flyway(schema, "85").migrate()

        val accountId = UUID.randomUUID()
        val instrumentId = UUID.randomUUID()
        val activeOrderId = UUID.randomUUID()
        val partiallyFilledOrderId = UUID.randomUUID()
        val activeBuyOrderId = UUID.randomUUID()
        val cancelledOrderId = UUID.randomUUID()
        execute(
            schema,
            """
            insert into account(id,email,password_hash,state_version,created_at)
            values ('$accountId','$accountId@test.local','test',1,now());
            insert into market_instrument(instrument_id,canonical_key,item_id,display_name,category)
            values ('$instrumentId','material:test','POTATO_M1','감자 한 조각','MATERIAL');
            insert into market_order(
              order_id,account_id,instrument_id,side,time_in_force,initial_quantity,filled_quantity,remaining_quantity,
              limit_unit_price,reserved_rice,status,priority_at,created_at,updated_at,expires_at,display_name_snapshot
            ) values
              ('$activeOrderId','$accountId','$instrumentId','SELL','GTC',10,0,10,100,0,'ACTIVE',
               '2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T08:00:00Z','감자 한 조각'),
              ('$partiallyFilledOrderId','$accountId','$instrumentId','SELL','GTC',10,2,8,100,0,'PARTIALLY_FILLED',
               '2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T09:00:00Z','감자 한 조각'),
              ('$activeBuyOrderId','$accountId','$instrumentId','BUY','GTC',10,0,10,100,1000,'ACTIVE',
               '2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T08:00:00Z','감자 한 조각'),
              ('$cancelledOrderId','$accountId','$instrumentId','SELL','GTC',10,0,10,100,0,'CANCELLED',
               '2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T08:00:00Z','감자 한 조각');
            """.trimIndent(),
        )

        flyway(schema).migrate()

        assertEquals(Instant.parse("2026-09-22T00:00:00Z"), expiresAt(schema, activeOrderId))
        assertEquals(Instant.parse("2026-09-22T01:00:00Z"), expiresAt(schema, partiallyFilledOrderId))
        assertEquals(Instant.parse("2026-09-21T08:00:00Z"), expiresAt(schema, cancelledOrderId))
        assertEquals(Instant.parse("2026-09-21T08:00:00Z"), expiresAt(schema, activeBuyOrderId))
    }

    private fun flyway(schema: String, target: String = "latest") = Flyway.configure().configuration(mapOf("flyway.postgresql.transactional.lock" to "false"))
        .dataSource(database.jdbcUrl, database.username, database.password)
        .schemas(schema)
        .defaultSchema(schema)
        .locations("classpath:db/migration")
        .target(target)
        .load()

    private fun execute(schema: String, statement: String) {
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use {
                it.execute("set search_path to $schema")
                it.execute(statement)
            }
        }
    }

    private fun expiresAt(schema: String, orderId: UUID): Instant =
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use {
                it.execute("set search_path to $schema")
                it.executeQuery("select expires_at from market_order where order_id='$orderId'").use { result ->
                    check(result.next())
                    result.getObject(1, OffsetDateTime::class.java).toInstant()
                }
            }
        }

    companion object {
        private val database = PostgresTestDatabase.connection
    }
}
