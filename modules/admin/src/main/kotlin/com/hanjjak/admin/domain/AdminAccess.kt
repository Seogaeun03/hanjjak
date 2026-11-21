package com.hanjjak.admin.domain

import java.time.Instant
import java.util.UUID

enum class AdminRole {
    VIEWER,
    CS_OPERATOR,
    GAME_OPERATOR,
    ENGINEER,
    ADMIN,
}

enum class AdminLoginPurpose {
    CONSOLE,
    GAME,
}

enum class AdminPermission(val wireName: String) {
    DASHBOARD_READ("dashboard:read"),
    ACCOUNT_READ("account:read"),
    ACCOUNT_PII_READ("account:pii-read"),
    USER_MANAGE("user:manage"),
    OUTBOX_RETRY("outbox:retry"),
    ECONOMY_READ("economy:read"),
    OUTBOX_READ("outbox:read"),
    AUDIT_READ("audit:read"),
    CHAT_MODERATE("chat:moderate"),
    MARKET_MANAGE("market:manage"),
    MESSAGE_SEND("message:send"),
    QA_READ("qa:read"),
    COSMETIC_SHOWCASE_MANAGE("cosmetic-showcase:manage"),
    EVENT_LIFECYCLE_MANAGE("event-lifecycle:manage"),
    LIVEOPS_MANAGE("liveops:manage"),
}
private val ROLE_PERMISSIONS = mapOf(
    AdminRole.VIEWER to setOf(AdminPermission.DASHBOARD_READ, AdminPermission.ECONOMY_READ),
    AdminRole.ENGINEER to setOf(AdminPermission.DASHBOARD_READ, AdminPermission.ECONOMY_READ, AdminPermission.ACCOUNT_READ, AdminPermission.OUTBOX_READ, AdminPermission.OUTBOX_RETRY, AdminPermission.AUDIT_READ, AdminPermission.QA_READ, AdminPermission.LIVEOPS_MANAGE),
    AdminRole.ADMIN to AdminPermission.entries.toSet(),
)

data class AdminOperator(
    val operatorId: UUID,
    val username: String,
    val displayName: String,
    val enabled: Boolean,
    val gitlabUserId: Long?,
    val roles: Set<AdminRole>,
) {
    val permissions: Set<AdminPermission> = roles.flatMapTo(linkedSetOf()) { ROLE_PERMISSIONS.getValue(it) }
}

data class AdminPrincipal(
    val operatorId: UUID,
    val username: String,
    val displayName: String,
    val roles: Set<AdminRole>,
    val permissions: Set<AdminPermission>,
    val localLogin: Boolean = false,
)

data class AdminSession(
    val tokenHash: String,
    val operatorId: UUID,
    val expiresAt: Instant,
)
