package com.hanjjak.admin.infrastructure

import com.hanjjak.admin.domain.AdminOperator
import com.hanjjak.admin.domain.AdminLoginPurpose
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.domain.AdminRole
import com.hanjjak.admin.domain.AdminSession
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

@Repository
class AdminRepository(private val jdbc: JdbcClient) {
    data class GitlabFlow(val codeVerifier: String, val purpose: AdminLoginPurpose)

    fun findPrincipalByTokenHash(tokenHash: String, now: Instant): AdminPrincipal? {
        val row = jdbc.sql(
            """
            select o.operator_id, o.username, o.display_name, o.enabled, o.gitlab_user_id, o.local_login
            from admin_session s
            join admin_operator o on o.operator_id = s.operator_id
            where s.session_token_hash = :tokenHash
              and s.revoked_at is null
              and (o.gitlab_user_id is not null or o.local_login = true)
              and s.expires_at > :now
              and o.enabled = true
            """.trimIndent(),
        )
            .param("tokenHash", tokenHash)
            .param("now", Timestamp.from(now))
            .query(::operatorRow)
            .optional()
            .orElse(null) ?: return null
        return row.toOperator(roles(row.operatorId)).let {
            AdminPrincipal(it.operatorId, it.username, it.displayName, it.roles, it.permissions, row.localLogin)
        }
    }

    fun touchSession(tokenHash: String, now: Instant, inactiveBefore: Instant): Boolean = jdbc.sql(
        """
        update admin_session
        set last_seen_at = :now
        where session_token_hash = :tokenHash
          and revoked_at is null
          and expires_at > :now
          and last_seen_at > :inactiveBefore
        """.trimIndent(),
    )
        .param("now", Timestamp.from(now))
        .param("inactiveBefore", Timestamp.from(inactiveBefore))
        .param("tokenHash", tokenHash)
        .update() == 1

    fun saveSession(session: AdminSession, now: Instant) {
        jdbc.sql("update admin_session set revoked_at = :now where operator_id = :operatorId and revoked_at is null")
            .param("now", Timestamp.from(now))
            .param("operatorId", session.operatorId)
            .update()
        jdbc.sql(
            """
            insert into admin_session(session_token_hash, operator_id, created_at, last_seen_at, expires_at)
            values (:tokenHash, :operatorId, :now, :now, :expiresAt)
            """.trimIndent(),
        )
            .param("tokenHash", session.tokenHash)
            .param("operatorId", session.operatorId)
            .param("now", Timestamp.from(now))
            .param("expiresAt", Timestamp.from(session.expiresAt))
            .update()
    }

    fun revokeSession(tokenHash: String, now: Instant) {
        jdbc.sql("update admin_session set revoked_at = :now where session_token_hash = :tokenHash and revoked_at is null")
            .param("now", Timestamp.from(now))
            .param("tokenHash", tokenHash)
            .update()
    }

    fun saveGitlabFlow(
        stateTokenHash: String,
        codeVerifier: String,
        purpose: AdminLoginPurpose,
        createdAt: Instant,
        expiresAt: Instant,
    ) {
        jdbc.sql(
            """
            insert into admin_gitlab_oauth_flow(flow_id, state_token_hash, code_verifier, login_purpose, created_at, expires_at)
            values (:flowId, :stateTokenHash, :codeVerifier, :purpose, :createdAt, :expiresAt)
            """.trimIndent(),
        )
            .param("flowId", UUID.randomUUID())
            .param("stateTokenHash", stateTokenHash)
            .param("codeVerifier", codeVerifier)
            .param("purpose", purpose.name)
            .param("createdAt", Timestamp.from(createdAt))
            .param("expiresAt", Timestamp.from(expiresAt))
            .update()
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun findGitlabFlow(stateTokenHash: String, now: Instant): GitlabFlow? {
        val flow = jdbc.sql(
            """
            select code_verifier, login_purpose
            from admin_gitlab_oauth_flow
            where state_token_hash = :stateTokenHash
              and consumed = false
              and expires_at > :now
            for update
            """.trimIndent(),
        )
            .param("stateTokenHash", stateTokenHash)
            .param("now", Timestamp.from(now))
            .query { result, _ -> GitlabFlow(result.getString("code_verifier"), AdminLoginPurpose.valueOf(result.getString("login_purpose"))) }
            .optional()
            .orElse(null) ?: return null
        val consumed = jdbc.sql("update admin_gitlab_oauth_flow set consumed = true where state_token_hash = :stateTokenHash and consumed = false")
            .param("stateTokenHash", stateTokenHash)
            .update()
        return flow.takeIf { consumed == 1 }
    }

    fun deleteExpiredGitlabFlows(now: Instant) {
        jdbc.sql("delete from admin_gitlab_oauth_flow where expires_at <= :now")
            .param("now", Timestamp.from(now))
            .update()
    }

    fun findGameAccount(operatorId: UUID): UUID? = jdbc.sql(
        "select account_id from admin_game_account where operator_id = :operatorId",
    )
        .param("operatorId", operatorId)
        .query(UUID::class.java)
        .optional()
        .orElse(null)

    fun isGameAccount(accountId: UUID): Boolean = jdbc.sql(
        "select count(*) from admin_game_account where account_id = :accountId",
    )
        .param("accountId", accountId)
        .query(Int::class.java)
        .single() == 1

    fun linkGameAccount(operatorId: UUID, accountId: UUID, now: Instant) {
        jdbc.sql("insert into admin_game_account(operator_id,account_id,created_at) values (:operatorId,:accountId,:now)")
            .params(mapOf("operatorId" to operatorId, "accountId" to accountId, "now" to Timestamp.from(now)))
            .update()
    }

    fun upsertGitlabOperator(gitlabUserId: Long, username: String, displayName: String): AdminOperator {
        val operatorId = jdbc.sql(
            """
            select operator_id from admin_operator
            where gitlab_user_id = :gitlabUserId or (gitlab_user_id is null and local_login = false and username = :username)
            order by case when gitlab_user_id = :gitlabUserId then 0 else 1 end
            limit 1
            """.trimIndent(),
        )
            .param("gitlabUserId", gitlabUserId)
            .param("username", username)
            .query(UUID::class.java)
            .optional()
            .orElse(null)
        val persistedId = operatorId ?: UUID.randomUUID()
        val conflictingUsername = jdbc.sql("select count(*) from admin_operator where username = :username and operator_id <> :operatorId")
            .param("username", username)
            .param("operatorId", persistedId)
            .query(Long::class.java)
            .single() > 0
        require(!conflictingUsername) { "ADMIN_GITLAB_IDENTITY_CONFLICT" }
        val command = if (operatorId == null) {
            jdbc.sql(
                "insert into admin_operator(operator_id, username, display_name, gitlab_user_id) values (:operatorId, :username, :displayName, :gitlabUserId)",
            )
        } else {
            jdbc.sql(
                "update admin_operator set username = :username, display_name = :displayName, gitlab_user_id = :gitlabUserId, updated_at = current_timestamp where operator_id = :operatorId",
            )
        }
        command
            .param("operatorId", persistedId)
            .param("username", username)
            .param("displayName", displayName.take(120))
            .param("gitlabUserId", gitlabUserId)
            .update()
        val row = jdbc.sql(
            """
            select operator_id, username, display_name, enabled, gitlab_user_id, local_login
            from admin_operator
            where operator_id = :operatorId
            """.trimIndent(),
        )
            .param("operatorId", persistedId)
            .query(::operatorRow)
            .single()
        jdbc.sql("insert into admin_operator_role(operator_id, role) select :operatorId, 'ADMIN' where not exists (select 1 from admin_operator_role where operator_id = :operatorId and role = 'ADMIN')")
            .param("operatorId", row.operatorId)
            .update()
        return row.toOperator(roles(row.operatorId))
    }

    fun upsertLocalOperator(username: String): AdminOperator {
        val operatorId = jdbc.sql("select operator_id from admin_operator where local_login = true and username = :username")
            .param("username", username)
            .query(UUID::class.java)
            .optional()
            .orElse(null)
        if (operatorId == null) {
            val usernameTaken = jdbc.sql("select count(*) from admin_operator where username = :username")
                .param("username", username)
                .query(Long::class.java)
                .single() > 0
            require(!usernameTaken) { "ADMIN_LOCAL_LOGIN_FAILED" }
        }
        val persistedId = operatorId ?: UUID.randomUUID()
        if (operatorId == null) {
            jdbc.sql("insert into admin_operator(operator_id, username, display_name, gitlab_user_id, local_login) values (:operatorId, :username, :displayName, null, true)")
                .param("operatorId", persistedId)
                .param("username", username)
                .param("displayName", username.take(120))
                .update()
        }
        jdbc.sql("insert into admin_operator_role(operator_id, role) select :operatorId, 'ADMIN' where not exists (select 1 from admin_operator_role where operator_id = :operatorId and role = 'ADMIN')")
            .param("operatorId", persistedId)
            .update()
        val row = jdbc.sql("select operator_id, username, display_name, enabled, gitlab_user_id, local_login from admin_operator where operator_id = :operatorId and local_login = true")
            .param("operatorId", persistedId)
            .query(::operatorRow)
            .single()
        return row.toOperator(roles(persistedId))
    }

    private fun operatorRow(result: java.sql.ResultSet, @Suppress("UNUSED_PARAMETER") rowNumber: Int) = OperatorRow(
        result.getObject("operator_id", UUID::class.java),
        result.getString("username"),
        result.getString("display_name"),
        result.getBoolean("enabled"),
        result.getObject("gitlab_user_id", java.lang.Long::class.java)?.toLong(),
        result.getBoolean("local_login"),
    )

    private fun roles(operatorId: UUID): Set<AdminRole> = jdbc.sql(
        "select role from admin_operator_role where operator_id = :operatorId order by role",
    )
        .param("operatorId", operatorId)
        .query(String::class.java)
        .list()
        .mapTo(linkedSetOf()) { AdminRole.valueOf(it) }

    private data class OperatorRow(
        val operatorId: UUID,
        val username: String,
        val displayName: String,
        val enabled: Boolean,
        val gitlabUserId: Long?,
        val localLogin: Boolean,
    ) {
        fun toOperator(roles: Set<AdminRole>) = AdminOperator(operatorId, username, displayName, enabled, gitlabUserId, roles)
    }
}
