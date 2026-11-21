package com.hanjjak.admin.application

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.net.URI

/** Validates local configuration only; provider authentication is not inferred from a key's shape. */
@Component
class CosmeticStudioByok(
    @Value("\${BYOK_API_URL:}") apiUrl: String,
    @Value("\${BYOK_API_KEY:}") apiKey: String,
) {
    private val configured = validUrl(apiUrl) && apiKey.isNotBlank() && apiKey.all { it.code in 33..126 }

    fun requireConfigured() {
        require(configured) { ERROR_CODE }
    }

    private fun validUrl(value: String): Boolean {
        if (value.isBlank()) return false
        val uri = try { URI(value) } catch (_: Exception) { return false }
        return uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawFragment == null && (uri.port == -1 || uri.port in 1..65535)
    }

    companion object {
        const val ERROR_CODE = "COSMETIC_STUDIO_BYOK_NOT_CONFIGURED"
    }
}
