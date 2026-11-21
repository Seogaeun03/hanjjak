package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.EventLifecycleService
import com.hanjjak.admin.infrastructure.AdminRepository
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import java.time.Clock

@Configuration
class EventLifecycleFilterConfiguration {
    @Bean
    fun eventLifecycleFilter(lifecycle: EventLifecycleService, admins: AdminRepository, mapper: ObjectMapper, clock: Clock) =
        EventLifecycleFilter(lifecycle, admins, mapper, clock)

    @Bean
    fun eventLifecycleFilterRegistration(filter: EventLifecycleFilter) = FilterRegistrationBean(filter).apply {
        order = Ordered.HIGHEST_PRECEDENCE
        addUrlPatterns("/api/v1/*", "/ws/chat")
    }
}
