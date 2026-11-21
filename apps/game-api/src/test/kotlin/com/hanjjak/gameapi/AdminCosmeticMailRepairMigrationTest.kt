package com.hanjjak.gameapi

import java.sql.DriverManager
import java.util.UUID
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AdminCosmeticMailRepairMigrationTest {
    @Test
    fun `repairs only cosmetics backed by claimed admin mail and records an audit row`() {
        val database = PostgresTestDatabase.connection
        val schema = "admin_cosmetic_repair_${UUID.randomUUID().toString().replace("-", "")}"
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use { it.execute("create schema $schema") }
        }
        flyway(schema, "86").migrate()

        val affected = UUID.randomUUID()
        val fullyReserved = UUID.randomUUID()
        val unrelated = UUID.randomUUID()
        val operator = UUID.randomUUID()
        val send = UUID.randomUUID()
        val claimedMail = UUID.randomUUID()
        execute(
            schema,
            """
            insert into account(id,email,password_hash,state_version,created_at) values
              ('$affected','$affected@test.local','test',1,now()),
              ('$fullyReserved','$fullyReserved@test.local','test',1,now()),
              ('$unrelated','$unrelated@test.local','test',1,now());
            insert into admin_operator(operator_id,username,display_name)
            values ('$operator','repair-test','복구 테스트');
            insert into admin_mail_send(
              send_id,operator_id,target_mode,target_account_id,title,rice_amount,rewards_json,
              recipient_count,reason,created_at,body,sender_name,published_at
            ) values (
              '$send','$operator','ACCOUNT','$affected','치장 지급',0,
              '[{"kind":"COSMETIC","quantity":2,"cosmeticId":"cosmetic-001","displayName":"가죽경갑 모자"}]'::jsonb,
              1,'migration test',now(),'치장을 지급합니다.','운영자',now()
            );
            insert into mail_message(
              mail_id,account_id,type,rice_amount,claimed,created_at,claimed_at,title,body,sender_name,
              rewards_json,send_id,reward_status
            ) values (
              '$claimedMail','$affected','ADMIN_MESSAGE',0,true,now(),now(),'치장 지급','치장을 지급합니다.','운영자',
              '[{"kind":"COSMETIC","quantity":2,"cosmeticId":"cosmetic-001","displayName":"가죽경갑 모자"}]'::jsonb,
              '$send','CLAIMED'
            ), (
              '${UUID.randomUUID()}','$fullyReserved','ADMIN_MESSAGE',0,true,now(),now(),'치장 지급','치장을 지급합니다.','운영자',
              '[{"kind":"COSMETIC","quantity":1,"cosmeticId":"cosmetic-001","displayName":"가죽경갑 모자"}]'::jsonb,
              '$send','CLAIMED'
            );
            insert into cosmetic_collection_state(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity) values
              ('$affected','cosmetic-001',0,2,0),
              ('$fullyReserved','cosmetic-001',0,1,1),
              ('$unrelated','cosmetic-001',0,1,0);
            """.trimIndent(),
        )

        flyway(schema).migrate()

        assertEquals(listOf(1, 1), quantities(schema, affected))
        assertEquals(listOf(1, 1), quantities(schema, fullyReserved))
        assertEquals(listOf(0, 1), quantities(schema, unrelated))
        assertEquals(2, scalar(schema, "select count(*) from cosmetic_mail_registration_repair_v87"))
        assertEquals(2, scalar(schema, "select state_version from account where id='$affected'"))
        assertEquals(2, scalar(schema, "select state_version from account where id='$fullyReserved'"))
        assertEquals(1, scalar(schema, "select state_version from account where id='$unrelated'"))
        assertEquals(
            claimedMail.toString(),
            text(schema, "select source_mail_ids[1]::text from cosmetic_mail_registration_repair_v87 where account_id='$affected'"),
        )
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

    private fun quantities(schema: String, accountId: UUID): List<Int> =
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use {
                it.execute("set search_path to $schema")
                it.executeQuery(
                    "select registered_quantity,unregistered_quantity from cosmetic_collection_state where account_id='$accountId' and cosmetic_id='cosmetic-001'",
                ).use { result ->
                    check(result.next())
                    listOf(result.getInt(1), result.getInt(2))
                }
            }
        }

    private fun scalar(schema: String, query: String): Int =
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use {
                it.execute("set search_path to $schema")
                it.executeQuery(query).use { result -> check(result.next()); result.getInt(1) }
            }
        }

    private fun text(schema: String, query: String): String =
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            connection.createStatement().use {
                it.execute("set search_path to $schema")
                it.executeQuery(query).use { result -> check(result.next()); result.getString(1) }
            }
        }

    companion object {
        private val database = PostgresTestDatabase.connection
    }
}
