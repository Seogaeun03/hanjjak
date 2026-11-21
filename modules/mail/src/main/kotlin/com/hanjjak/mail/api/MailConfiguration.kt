package com.hanjjak.mail.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.cosmetics.domain.CosmeticsContent
import com.hanjjak.inventory.application.InventoryRepository
import com.hanjjak.inventory.application.InventoryReservationService
import com.hanjjak.mail.application.BannerRepository
import com.hanjjak.mail.application.BannerService
import com.hanjjak.mail.application.MailRepository
import com.hanjjak.mail.application.MailRewardGranter
import com.hanjjak.mail.application.MailService
import com.hanjjak.mail.application.NoticeRepository
import com.hanjjak.mail.application.NoticeService
import com.hanjjak.mail.infrastructure.JdbcBannerRepository
import com.hanjjak.mail.infrastructure.JdbcMailRepository
import com.hanjjak.mail.infrastructure.JdbcMailRewardGranter
import com.hanjjak.mail.infrastructure.JdbcNoticeRepository
import com.hanjjak.wallet.application.WalletService
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock

@Configuration
class MailConfiguration {
    @Bean fun mailRepository(jdbc: JdbcClient, mapper: ObjectMapper): MailRepository = JdbcMailRepository(jdbc, mapper)
    @Bean fun noticeRepository(jdbc: JdbcClient): NoticeRepository = JdbcNoticeRepository(jdbc)
    @Bean fun bannerRepository(jdbc: JdbcClient): BannerRepository = JdbcBannerRepository(jdbc)
    @Bean fun mailRewardGranter(
        jdbc: JdbcClient,
        inventory: InventoryRepository,
        reservations: InventoryReservationService,
        clock: Clock,
        cosmetics: CosmeticsContent,
    ): MailRewardGranter = JdbcMailRewardGranter(jdbc, inventory, reservations, clock, cosmetics)
    @Bean fun mailService(
        repository: MailRepository,
        wallet: WalletService,
        mapper: ObjectMapper,
        clock: Clock,
        granter: MailRewardGranter,
    ) = MailService(repository, wallet, mapper, clock, granter)
    @Bean fun noticeService(repository: NoticeRepository, clock: Clock) = NoticeService(repository, clock)
    @Bean fun bannerService(repository: BannerRepository, clock: Clock) = BannerService(repository, clock)
}
