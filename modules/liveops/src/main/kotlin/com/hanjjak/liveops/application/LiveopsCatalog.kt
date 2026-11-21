package com.hanjjak.liveops.application

import com.hanjjak.liveops.domain.LiveopsContent

/**
 * 지금 저장소에는 이벤트가 하나뿐이다. 여러 이벤트를 동시에 열게 되면 이 클래스가
 * 목록을 들고 `require` 가 골라 주는 자리가 된다. 호출부는 그때도 바뀌지 않는다.
 */
class LiveopsCatalog(private val content: LiveopsContent) {
    fun current(): LiveopsContent = content

    fun require(eventId: String): LiveopsContent {
        require(eventId == content.eventId) { "LIVEOPS_EVENT_NOT_FOUND" }
        return content
    }
}
