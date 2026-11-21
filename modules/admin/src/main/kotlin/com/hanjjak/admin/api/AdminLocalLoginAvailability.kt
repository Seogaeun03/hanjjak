package com.hanjjak.admin.api

import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

@Component
class AdminLocalLoginAvailability(
    private val properties: AdminProperties,
    private val environment: Environment,
) {
    fun isEnabled(): Boolean {
        val credentials = properties.localLogin
        return environment.activeProfiles.contentEquals(arrayOf("local")) &&
            credentials.enabled &&
            !properties.gitlab.enabled &&
            credentials.username.isNotBlank() &&
            credentials.username.toByteArray(StandardCharsets.UTF_8).size <= 255 &&
            credentials.password.toByteArray(StandardCharsets.UTF_8).size >= MINIMUM_PASSWORD_BYTES
    }

    fun credentialsMatch(username: String, password: String): Boolean {
        if (!isEnabled()) return false
        val usernameMatches = constantTimeEquals(username, properties.localLogin.username)
        val passwordMatches = constantTimeEquals(password, properties.localLogin.password)
        return usernameMatches && passwordMatches
    }

    private fun constantTimeEquals(actual: String, expected: String): Boolean {
        val actualHash = MessageDigest.getInstance("SHA-256").digest(actual.toByteArray(StandardCharsets.UTF_8))
        val expectedHash = MessageDigest.getInstance("SHA-256").digest(expected.toByteArray(StandardCharsets.UTF_8))
        return MessageDigest.isEqual(actualHash, expectedHash)
    }

    private companion object {
        const val MINIMUM_PASSWORD_BYTES = 32
    }
}
