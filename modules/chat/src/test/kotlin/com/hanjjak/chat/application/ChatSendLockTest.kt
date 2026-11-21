package com.hanjjak.chat.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.hanjjak.chat.domain.ChatSendRequest
import com.hanjjak.events.application.DomainEventPublishRequest
import com.hanjjak.events.application.DomainEventPublisher
import java.lang.reflect.Proxy
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ChatSendLockTest {
    @Test
    fun `disabled toggle blocks new sends and replays before writes then re-enables`() {
        var enabled = true
        var messageWrites = 0
        var commandReads = 0
        var commandWrites = 0
        val published = mutableListOf<DomainEventPublishRequest>()
        val repository = Proxy.newProxyInstance(
            ChatRepository::class.java.classLoader,
            arrayOf(ChatRepository::class.java),
        ) { _, method, args ->
            when (method.name) {
                "chatSendEnabledForUpdate" -> enabled
                "isChatBanned" -> false
                "command" -> { commandReads++; null }
                "account" -> ChatRepository.AccountView("nickname", "POTATO")
                "createMessage" -> { messageWrites++; null }
                "saveCommand" -> { commandWrites++; null }
                else -> error("Unexpected repository call: ${method.name}")
            }
        } as ChatRepository
        val events = object : DomainEventPublisher {
            override fun publish(request: DomainEventPublishRequest): UUID {
                published += request
                return UUID.randomUUID()
            }
        }
        val service = ChatService(
            repository,
            ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule()),
            Clock.fixed(Instant.parse("2026-09-30T12:00:00Z"), ZoneOffset.UTC),
            events,
        )
        val accountId = UUID.randomUUID()
        val replayKey = UUID.randomUUID()
        val request = ChatSendRequest("감자 팝니다")

        service.sendMessage(accountId, replayKey, request)
        assertEquals(1, messageWrites)
        assertEquals(1, commandWrites)
        assertEquals(1, published.size)

        enabled = false
        assertEquals("CHAT_DISABLED", assertFailsWith<IllegalArgumentException> {
            service.sendMessage(accountId, UUID.randomUUID(), request)
        }.message)
        assertEquals("CHAT_DISABLED", assertFailsWith<IllegalArgumentException> {
            service.sendMessage(accountId, replayKey, request)
        }.message)
        assertEquals(1, messageWrites)
        assertEquals(1, commandWrites)
        assertEquals(1, published.size)
        assertEquals(1, commandReads, "the disabled gate must run before replay lookup")

        enabled = true
        service.sendMessage(accountId, UUID.randomUUID(), request)
        assertEquals(2, messageWrites)
        assertEquals(2, commandWrites)
        assertEquals(2, published.size)
        assertTrue(published.all { it.eventType == "CHAT_MESSAGE_CREATED" })
    }
}
