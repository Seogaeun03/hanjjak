package com.hanjjak.gameapi.liveops

import com.hanjjak.events.application.DomainEventPublisher
import com.hanjjak.liveops.application.LiveopsAccountLock
import com.hanjjak.inventory.application.InventoryRewardService
import com.hanjjak.liveops.application.LiveopsCosmeticTicketCredit
import com.hanjjak.liveops.application.LiveopsGemBoxCredit
import com.hanjjak.liveops.application.LiveopsPrizeNotice
import com.hanjjak.liveops.application.LiveopsRiceCredit
import com.hanjjak.wallet.application.WalletService
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

/** 계정 잠금. 저장소 전체와 같은 `select id from account where id=? for update` 모양을 쓴다. */
@Component
class JdbcLiveopsAccountLock(private val jdbc: JdbcClient) : LiveopsAccountLock {
    override fun lock(accountId: UUID) {
        jdbc.sql("select id from account where id=:account for update")
            .param("account", accountId)
            .query(UUID::class.java)
            .optional()
            .orElseThrow { IllegalArgumentException("AUTHENTICATION_REQUIRED") }
    }
}

@Component
class WalletLiveopsRiceCredit(private val wallet: WalletService) : LiveopsRiceCredit {
    override fun credit(accountId: UUID, amount: Long, sourceId: UUID) {
        wallet.credit(accountId, amount, "LIVEOPS_DRAW", sourceId)
    }
}

@Component
class CharacterLiveopsCosmeticTicketCredit(private val jdbc: JdbcClient) : LiveopsCosmeticTicketCredit {
    override fun credit(accountId: UUID, amount: Long) {
        require(amount > 0) { "INVALID_TICKET_AMOUNT" }
        /* 치장 뽑기권은 character 컬럼이다. 기존 최초 클리어·우편 지급과 같은 경로를 쓴다. */
        val changed = jdbc.sql("update character set cosmetic_ticket_balance=cosmetic_ticket_balance+:amount where account_id=:account")
            .params(mapOf("account" to accountId, "amount" to amount)).update()
        require(changed == 1) { "LIVEOPS_COSMETIC_TICKET_GRANT_FAILED" }
        /* 뽑기의 모든 보상 경로는 state_version 을 올려야 한다 — 그러지 않으면 이 값으로
           재동기화하는 클라이언트가 방금 받은 보상을 조용히 놓친다. */
        jdbc.sql("update account set state_version=state_version+1 where id=:account").param("account", accountId).update()
    }
}

/**
 * 보석함 지급. 레이드 보상과 같은 `GEM_BOX` 아이템이라 같은 인벤토리 경로를 쓴다.
 *
 * 뽑기 서비스가 계정 행을 이미 잠근 뒤에 부르므로 `*Locked` 쌍을 그대로 쓴다.
 * [preflight] 는 `INVENTORY_CAPACITY_EXCEEDED` 를 던져 뽑기를 티켓 차감 전에 멈춘다.
 */
@Component
class InventoryLiveopsGemBoxCredit(
    private val inventory: InventoryRewardService,
    private val jdbc: JdbcClient,
) : LiveopsGemBoxCredit {
    override fun preflight(accountId: UUID, quantity: Long) {
        inventory.preflightGrantLocked(accountId, GEM_BOX_ITEM_ID, quantity)
    }

    override fun credit(accountId: UUID, quantity: Long) {
        require(quantity > 0) { "INVALID_GEM_BOX_QUANTITY" }
        inventory.grantLocked(accountId, GEM_BOX_ITEM_ID, quantity)
        /* grantLocked 는 재고만 올리고 state_version 은 건드리지 않는다. 치장 뽑기권과 같이
           여기서 올려 둬야 이 값으로 재동기화하는 클라이언트가 방금 받은 보석함을 놓치지 않는다. */
        jdbc.sql("update account set state_version=state_version+1 where id=:account").param("account", accountId).update()
    }

    private companion object {
        const val GEM_BOX_ITEM_ID = "GEM_BOX"
    }
}

/**
 * 경품 당첨 안내. 보상이 없는 안내 전용 우편이라 `reward_status='NONE'`, `rewards_json='[]'` 로 넣는다.
 *
 * 연락처는 게임이 묻지 않는다. 운영자가 어드민에서 당첨자를 보고 게임 밖에서 연락한다.
 * `claimed` 는 구버전 파드가 아직 읽을 수 있어 함께 채운다(V60 주석 참고).
 */
@Component
class MailLiveopsPrizeNotice(
    private val jdbc: JdbcClient,
    private val events: DomainEventPublisher,
) : LiveopsPrizeNotice {
    override fun notify(accountId: UUID, prizeDisplayName: String, winId: UUID, at: Instant) {
        jdbc.sql(
            """insert into mail_message(mail_id,account_id,type,rice_amount,reward_status,claimed,created_at,title,body,sender_name,rewards_json)
               values (:mail,:account,'LIVEOPS_PRIZE',0,'NONE',true,:now,:title,:body,:sender,cast('[]' as jsonb))""",
        ).params(
            mapOf(
                "mail" to UUID.randomUUID(),
                "account" to accountId,
                "now" to OffsetDateTime.ofInstant(at, ZoneOffset.UTC),
                "title" to "경품 당첨 안내",
                "body" to "$prizeDisplayName 에 당첨되셨습니다. 운영자가 개별로 연락드립니다.",
                "sender" to "한짝 운영팀",
            ),
        ).update()
        jdbc.sql("update account set state_version=state_version+1 where id=:account").param("account", accountId).update()
        events.publish(
            eventType = "LIVEOPS_PRIZE_WON",
            aggregateId = accountId,
            occurredAt = at,
            accountId = accountId,
            quantity = 1,
            commandId = winId,
            payload = mapOf("winId" to winId, "prizeDisplayName" to prizeDisplayName),
        )
    }
}
