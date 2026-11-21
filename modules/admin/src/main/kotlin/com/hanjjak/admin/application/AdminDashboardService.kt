package com.hanjjak.admin.application

import com.hanjjak.admin.api.AdminProperties
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant

@Service
class AdminDashboardService(
    private val jdbc: JdbcClient,
    private val properties: AdminProperties,
    private val clock: Clock,
) {
    data class ServiceHealth(val status: String, val checkedAt: Instant)
    data class Deployment(val application: String, val commitSha: String, val contentVersion: String, val contentAuthority: String)
    data class Counts(
        val totalAccounts: Long,
        val activeAccountSessions: Long,
        val activeGameSessions: Long,
        val activeBattleSessions: Long,
        val processingCommands: Long,
        val pendingOutboxEvents: Long,
        val failedOutboxEvents: Long,
        val oldestPendingOutboxAt: Instant?,
        val activeMarketOrders: Long,
        val unclaimedMails: Long,
    )
    data class Dashboard(val service: ServiceHealth, val deployment: Deployment, val counts: Counts)

    fun dashboard(): Dashboard {
        val row = jdbc.sql(
            """
            with outbox_counts as (
              select
                count(*) filter (where status = 'PENDING') as pending_outbox_events,
                count(*) filter (where status = 'FAILED') as failed_outbox_events,
                min(created_at) filter (where status = 'PENDING') as oldest_pending_outbox_at
              from outbox_event
              where status in ('PENDING', 'FAILED')
            )
            select
              (select count(*) from account) as total_accounts,
              (select count(*) from account_active_session) as active_account_sessions,
              (select count(*) from game_session where status = 'ACTIVE') as active_game_sessions,
              (select count(*) from battle_session where status = 'ACTIVE') as active_battle_sessions,
              (select count(*) from command_record where status = 'PROCESSING') as processing_commands,
              pending_outbox_events,
              failed_outbox_events,
              oldest_pending_outbox_at,
              (select count(*) from market_order where status in ('ACTIVE','PARTIALLY_FILLED')) as active_market_orders,
              (select count(*) from mail_message where reward_status = 'PENDING' and deleted_at is null) as unclaimed_mails
            from outbox_counts
            """.trimIndent(),
        ).query { result, _ ->
            Counts(
                result.getLong("total_accounts"),
                result.getLong("active_account_sessions"),
                result.getLong("active_game_sessions"),
                result.getLong("active_battle_sessions"),
                result.getLong("processing_commands"),
                result.getLong("pending_outbox_events"),
                result.getLong("failed_outbox_events"),
                result.getTimestamp("oldest_pending_outbox_at")?.toInstant(),
                result.getLong("active_market_orders"),
                result.getLong("unclaimed_mails"),
            )
        }.single()
        val deployment = properties.deployment
        return Dashboard(
            ServiceHealth("UP", clock.instant()),
            Deployment("game-api", deployment.commitSha, deployment.contentVersion, deployment.contentAuthority),
            row,
        )
    }
}
