package com.hanjjak.market.application

import org.springframework.scheduling.annotation.Scheduled
import java.time.Clock

private const val EXPIRY_BATCH_SIZE = 100

open class MarketOrderExpiryScheduler(
    private val repository: OrderBookRepository,
    private val orders: OrderBookService,
    private val clock: Clock,
) {
    @Scheduled(fixedDelayString = "\${market.orders.expiry-delay-ms:30000}")
    open fun expireOrders() {
        val now = clock.instant()
        repository.expiredInstrumentIds(now, EXPIRY_BATCH_SIZE).forEach { instrumentId ->
            orders.expireInstrumentOrders(instrumentId, now, EXPIRY_BATCH_SIZE)
        }
    }
}
