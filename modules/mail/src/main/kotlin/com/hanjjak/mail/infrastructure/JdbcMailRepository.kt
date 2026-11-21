package com.hanjjak.mail.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.core.type.TypeReference
import com.hanjjak.mail.application.MailRepository
import com.hanjjak.mail.application.SettlementMailRequest
import com.hanjjak.mail.domain.MailMessage
import com.hanjjak.mail.domain.MailReward
import com.hanjjak.mail.domain.MailRewardStatus
import org.springframework.jdbc.core.simple.JdbcClient
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/** 정산 메일을 한 문장에 몇 건까지 담을지의 상한이다. 체결 수만큼 늘어나는 파라미터를 나눠 보낸다. */
private const val SETTLEMENT_MAIL_BATCH_SIZE = 100

private const val COLUMNS =
    "mail_id,account_id,type,rice_amount,reward_status,created_at,claimed_at,title,body,sender_name,read_at,rewards_json::text as rewards_json"

/** 관리자 우편은 캠페인의 노출 기간 안에서만 보이고 읽고 받을 수 있다. 정산 우편은 항상 대상이다. */
private const val ACTIVE_MAIL =
    "(send_id is null or exists (select 1 from admin_mail_send send where send.send_id=mail_message.send_id and (send.expires_at is null or send.expires_at>now())))"

class JdbcMailRepository(private val jdbc: JdbcClient, private val mapper: ObjectMapper) : MailRepository {
    override fun stateVersion(accountId: UUID): Long = jdbc.sql("select state_version from account where id=:account")
        .param("account", accountId)
        .query(Long::class.java)
        .single()

    override fun command(accountId: UUID, idempotencyKey: UUID): MailRepository.StoredCommand? = jdbc.sql("select command_id,fingerprint,result_json::text from command_record where account_id=:account and idempotency_key=:key")
        .param("account", accountId).param("key", idempotencyKey)
        .query { row, _ -> MailRepository.StoredCommand(row.getObject("command_id", UUID::class.java), row.getString("fingerprint"), row.getString("result_json")) }
        .optional().orElse(null)

    override fun saveCommand(commandId: UUID, accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) {
        jdbc.sql("insert into command_record(command_id,account_id,idempotency_key,fingerprint,status,result_json,expires_at) values (:command,:account,:key,:fingerprint,'SUCCEEDED',cast(:result as jsonb),now()+interval '7 days')")
            .params(mapOf("command" to commandId, "account" to accountId, "key" to idempotencyKey, "fingerprint" to fingerprint, "result" to resultJson))
            .update()
    }

    override fun createSettlementMail(accountId: UUID, tradeId: UUID, riceAmount: Long): UUID {
        require(riceAmount >= 0) { "INVALID_RICE_AMOUNT" }
        val mailId = UUID.randomUUID()
        jdbc.sql("insert into mail_message(mail_id,account_id,type,rice_amount,source_trade_id,reward_status,claimed,created_at) values (:mail,:account,'MARKET_SETTLEMENT',:rice,:trade,'PENDING',false,now())")
            .params(mapOf("mail" to mailId, "account" to accountId, "rice" to riceAmount, "trade" to tradeId))
            .update()
        return mailId
    }

    override fun materializeAdminMails(accountId: UUID, now: Instant): Int {
        val missing = jdbc.sql(
            """
            select send.send_id
            from admin_mail_send send
            where send.published_at <= :now
              and (send.expires_at is null or send.expires_at > :now)
              and (send.target_mode='ALL' or send.target_account_id=:account or exists (
                select 1 from admin_mail_send_recipient recipient
                where recipient.send_id=send.send_id and recipient.account_id=:account
              ))
              and not exists (
                select 1 from mail_message mail
                where mail.send_id=send.send_id and mail.account_id=:account
              )
            order by send.published_at, send.send_id
            """.trimIndent(),
        ).params(mapOf("account" to accountId, "now" to Timestamp.from(now)))
            .query(UUID::class.java).list()

        var inserted = 0
        missing.forEach { sendId ->
            inserted += jdbc.sql(
                """
                insert into mail_message(
                  mail_id,account_id,type,rice_amount,reward_status,claimed,created_at,
                  title,body,sender_name,rewards_json,send_id
                )
                select :mail,:account,'ADMIN_GIFT',send.rice_amount,
                       case when send.rice_amount > 0 or send.rewards_json <> '[]'::jsonb then 'PENDING' else 'NONE' end,
                       not (send.rice_amount > 0 or send.rewards_json <> '[]'::jsonb),send.published_at,
                       send.title,send.body,send.sender_name,send.rewards_json,send.send_id
                from admin_mail_send send
                where send.send_id=:send and send.published_at <= :now
                  and (send.expires_at is null or send.expires_at > :now)
                  and (send.target_mode='ALL' or send.target_account_id=:account or exists (
                    select 1 from admin_mail_send_recipient recipient
                    where recipient.send_id=send.send_id and recipient.account_id=:account
                  ))
                on conflict (send_id,account_id) where send_id is not null do nothing
                """.trimIndent(),
            ).params(
                mapOf(
                    "mail" to UUID.randomUUID(), "account" to accountId, "send" to sendId,
                    "now" to Timestamp.from(now),
                ),
            ).update()
        }
        if (inserted > 0) {
            jdbc.sql("update account set state_version=state_version+1 where id=:account")
                .param("account", accountId).update()
        }
        return inserted
    }

    override fun createSettlementMails(requests: List<SettlementMailRequest>): List<UUID> {
        if (requests.isEmpty()) return emptyList()
        requests.forEach { require(it.riceAmount >= 0) { "INVALID_RICE_AMOUNT" } }
        val mailIds = requests.map { UUID.randomUUID() }
        // 왕복을 줄이려고 한 문장으로 모아 넣는다. 값 자체는 한 건씩 넣을 때와 같다.
        // 한 요청이 만드는 정산 메일 수에는 상한이 없으므로 bind 파라미터가 넘치지 않게 나눠 보낸다.
        requests.zip(mailIds).chunked(SETTLEMENT_MAIL_BATCH_SIZE).forEach { chunk ->
            val values = chunk.indices.joinToString(",") { i ->
                "(:mail$i,:account$i,'MARKET_SETTLEMENT',:rice$i,:trade$i,'PENDING',false,now())"
            }
            val params = mutableMapOf<String, Any>()
            chunk.forEachIndexed { i, (request, mailId) ->
                params["mail$i"] = mailId
                params["account$i"] = request.accountId
                params["rice$i"] = request.riceAmount
                params["trade$i"] = request.tradeId
            }
            jdbc.sql("insert into mail_message(mail_id,account_id,type,rice_amount,source_trade_id,reward_status,claimed,created_at) values $values")
                .params(params).update()
        }
        return mailIds
    }

    override fun list(accountId: UUID, claimable: Boolean?, cursor: Instant?, type: String?, limit: Int): List<MailMessage> {
        val where = buildString {
            append("account_id=:account and deleted_at is null and $ACTIVE_MAIL")
            append(claimableClause(claimable))
            if (type != null) append(" and type=:type")
            if (cursor != null) append(" and created_at < :cursor")
        }
        val params = mutableMapOf<String, Any>("account" to accountId, "limit" to limit)
        if (type != null) params["type"] = type
        if (cursor != null) params["cursor"] = Timestamp.from(cursor)
        return jdbc.sql("select $COLUMNS from mail_message where $where order by created_at desc, mail_id desc limit :limit")
            .params(params)
            .query(::mapMail)
            .list()
    }

    override fun count(accountId: UUID, claimable: Boolean?, type: String?): Long {
        val typeClause = if (type == null) "" else " and type=:type"
        var query = jdbc.sql("select count(*) from mail_message where account_id=:account and deleted_at is null and $ACTIVE_MAIL${claimableClause(claimable)}$typeClause")
            .param("account", accountId)
        if (type != null) query = query.param("type", type)
        return query.query(Long::class.java).single()
    }

    override fun lockClaimable(accountId: UUID, mailId: UUID): MailMessage? = jdbc.sql("select $COLUMNS from mail_message where account_id=:account and mail_id=:mail and reward_status='PENDING' and deleted_at is null and $ACTIVE_MAIL for update")
        .params(mapOf("account" to accountId, "mail" to mailId))
        .query(::mapMail)
        .optional().orElse(null)

    override fun lockClaimableAll(accountId: UUID, type: String?): List<MailMessage> {
        val typeClause = if (type == null) "" else " and type=:type"
        var query = jdbc.sql("select $COLUMNS from mail_message where account_id=:account and reward_status='PENDING' and deleted_at is null and $ACTIVE_MAIL$typeClause order by created_at, mail_id for update")
            .param("account", accountId)
        if (type != null) query = query.param("type", type)
        return query.query(::mapMail).list()
    }

    override fun markClaimed(mailIds: List<UUID>, claimedAt: Instant) {
        if (mailIds.isEmpty()) return
        jdbc.sql("update mail_message set reward_status='CLAIMED', claimed=true, claimed_at=:claimedAt where mail_id in (:mailIds) and reward_status='PENDING'")
            .params(mapOf("mailIds" to mailIds, "claimedAt" to Timestamp.from(claimedAt)))
            .update()
    }

    override fun lockOwned(accountId: UUID, mailId: UUID): MailMessage? = jdbc.sql("select $COLUMNS from mail_message where account_id=:account and mail_id=:mail and deleted_at is null and $ACTIVE_MAIL for update")
        .params(mapOf("account" to accountId, "mail" to mailId))
        .query(::mapMail)
        .optional().orElse(null)

    override fun markRead(mailId: UUID, readAt: Instant) {
        jdbc.sql("update mail_message set read_at=:readAt where mail_id=:mail and read_at is null")
            .params(mapOf("mail" to mailId, "readAt" to Timestamp.from(readAt)))
            .update()
    }

    override fun markDeleted(mailId: UUID, deletedAt: Instant) {
        jdbc.sql("update mail_message set deleted_at=:deletedAt where mail_id=:mail and deleted_at is null")
            .params(mapOf("mail" to mailId, "deletedAt" to Timestamp.from(deletedAt)))
            .update()
    }

    private fun claimableClause(claimable: Boolean?): String = when (claimable) {
        true -> " and reward_status='PENDING'"
        false -> " and reward_status<>'PENDING'"
        null -> ""
    }

    private fun mapMail(row: java.sql.ResultSet, rowNum: Int): MailMessage = MailMessage(
        mailId = row.getObject("mail_id", UUID::class.java),
        accountId = row.getObject("account_id", UUID::class.java),
        type = row.getString("type"),
        riceAmount = row.getLong("rice_amount"),
        rewardStatus = MailRewardStatus.valueOf(row.getString("reward_status")),
        createdAt = row.getTimestamp("created_at").toInstant(),
        claimedAt = row.getTimestamp("claimed_at")?.toInstant(),
        title = row.getString("title"),
        body = row.getString("body"),
        senderName = row.getString("sender_name"),
        readAt = row.getTimestamp("read_at")?.toInstant(),
        rewards = row.getString("rewards_json")?.takeIf { it.isNotBlank() }?.let { mapper.readValue(it, object : TypeReference<List<MailReward>>() {}) } ?: emptyList(),
    )
}
