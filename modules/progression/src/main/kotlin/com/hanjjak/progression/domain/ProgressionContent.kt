package com.hanjjak.progression.domain

data class FirstClearRewardDefinition(
    val rice: Long,
    /** 치장 뽑기권. 쌀과 같이 지갑으로 들어가므로 가방 칸을 쓰지 않는다. */
    val tickets: Long,
    val items: List<FirstClearItem>,
    val directSkillId: String?,
)

data class FirstClearItem(val itemId: String, val quantity: Long)

data class ProgressionContentEntry(
    val stageId: String,
    val normalExperience: Long,
    val bossExperience: Long,
    val normalRice: Long,
    val bossRice: Long,
    val firstClear: FirstClearRewardDefinition?,
)
