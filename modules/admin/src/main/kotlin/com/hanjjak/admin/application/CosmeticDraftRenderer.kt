package com.hanjjak.admin.application

import org.springframework.stereotype.Component
import java.awt.AlphaComposite
import java.awt.BasicStroke
import java.awt.Color
import java.awt.RenderingHints
import java.awt.geom.Path2D
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO

@Component
class CosmeticDraftRenderer {
    fun decodeConcept(bytes: ByteArray): DecodedConcept {
        require(bytes.isNotEmpty() && bytes.size <= MAX_CONCEPT_BYTES) { "COSMETIC_STUDIO_IMAGE_INVALID" }
        val type = when {
            bytes.size >= 8 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() &&
                bytes[2] == 0x4e.toByte() && bytes[3] == 0x47.toByte() && bytes[4] == 0x0d.toByte() &&
                bytes[5] == 0x0a.toByte() && bytes[6] == 0x1a.toByte() && bytes[7] == 0x0a.toByte() -> "image/png"
            bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> "image/jpeg"
            else -> throw IllegalArgumentException("COSMETIC_STUDIO_IMAGE_FORMAT_UNSUPPORTED")
        }
        try {
            val source = decodeSampled(bytes, type)
            val thumbnail = BufferedImage(RENDER_SOURCE_SIZE, RENDER_SOURCE_SIZE, BufferedImage.TYPE_INT_ARGB)
            try {
                val graphics = thumbnail.createGraphics()
                try {
                    graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
                    val crop = crop(source.width, source.height, RENDER_SOURCE_SIZE.toDouble() / RENDER_SOURCE_SIZE)
                    graphics.drawImage(source, 0, 0, RENDER_SOURCE_SIZE, RENDER_SOURCE_SIZE,
                        crop.left, crop.top, crop.right, crop.bottom, null)
                } finally {
                    graphics.dispose()
                }
            } finally {
                source.flush()
            }
            val encoded = ByteArrayOutputStream(16 * 1024)
            check(ImageIO.write(thumbnail, "png", encoded)) { "COSMETIC_STUDIO_PNG_ENCODING_FAILED" }
            val renderBytes = encoded.toByteArray()
            check(renderBytes.size <= MAX_RENDER_SOURCE_BYTES) { "COSMETIC_STUDIO_IMAGE_INVALID" }
            return DecodedConcept(type, renderBytes, thumbnail)
        } catch (exception: IllegalArgumentException) {
            throw exception
        } catch (_: Exception) {
            throw IllegalArgumentException("COSMETIC_STUDIO_IMAGE_INVALID")
        }
    }

    private fun decodeSampled(bytes: ByteArray, type: String): BufferedImage {
        val stream = ImageIO.createImageInputStream(ByteArrayInputStream(bytes))
            ?: throw IllegalArgumentException("COSMETIC_STUDIO_IMAGE_INVALID")
        stream.use { input ->
            val reader = ImageIO.getImageReaders(input).asSequence().firstOrNull()
                ?: throw IllegalArgumentException("COSMETIC_STUDIO_IMAGE_INVALID")
            try {
                reader.input = input
                require(reader.formatName.equals(if (type == "image/png") "png" else "jpeg", ignoreCase = true)) {
                    "COSMETIC_STUDIO_IMAGE_INVALID"
                }
                val width = reader.getWidth(0)
                val height = reader.getHeight(0)
                require(width in 1..MAX_DIMENSION && height in 1..MAX_DIMENSION && width.toLong() * height <= MAX_PIXELS) {
                    "COSMETIC_STUDIO_IMAGE_DIMENSIONS_INVALID"
                }
                val parameters = reader.defaultReadParam
                val subsampling = maxOf(1, kotlin.math.ceil(kotlin.math.sqrt(width.toDouble() * height / MAX_DECODE_PIXELS)).toInt())
                parameters.setSourceSubsampling(subsampling, subsampling, 0, 0)
                return reader.read(0, parameters) ?: throw IllegalArgumentException("COSMETIC_STUDIO_IMAGE_INVALID")
            } finally {
                reader.dispose()
            }
        }
    }

    fun render(concept: BufferedImage, slot: String, motion: String, frame: Int, revision: Int): ByteArray {
        require(slot in SLOTS && motion in MOTION_COUNTS && frame in 1..MOTION_COUNTS.getValue(motion) && revision >= 0) {
            "COSMETIC_STUDIO_FRAME_INVALID"
        }
        val image = BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
            val shape = shapeFor(slot)
            val pose = poseFor(motion, frame, revision)
            graphics.translate(192.0 + pose.x, 164.0 + pose.y)
            graphics.rotate(pose.rotation)
            graphics.scale(pose.scaleX, pose.scaleY)
            graphics.translate(-192.0, -164.0)
            graphics.clip(shape)
            val targetWidth = 236.0
            val targetHeight = 230.0
            val sourceCrop = crop(concept.width, concept.height, targetWidth / targetHeight)
            val pan = ((revision % 5) - 2) * 0.025
            val zoom = 1.0 + (revision % 3) * 0.018
            val drawWidth = targetWidth * zoom
            val drawHeight = targetHeight * zoom
            val drawX = 74.0 + (targetWidth - drawWidth) / 2.0 - pan * targetWidth
            val drawY = 49.0 + (targetHeight - drawHeight) / 2.0 + ((revision % 2) * 2 - 1) * 2.0
            graphics.drawImage(concept, drawX.toInt(), drawY.toInt(), (drawX + drawWidth).toInt(), (drawY + drawHeight).toInt(),
                sourceCrop.left, sourceCrop.top, sourceCrop.right, sourceCrop.bottom, null)
            graphics.composite = AlphaComposite.SrcAtop.derive(0.12f)
            graphics.color = SLOT_TINT.getValue(slot)
            graphics.fill(shape)
            graphics.composite = AlphaComposite.SrcOver
            graphics.color = Color(255, 255, 255, 235)
            graphics.stroke = BasicStroke(3.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
            graphics.draw(shape)
            graphics.color = SLOT_TINT.getValue(slot)
            graphics.stroke = BasicStroke(1.25f)
            graphics.draw(shape)
        } finally {
            graphics.dispose()
        }
        val output = ByteArrayOutputStream(32 * 1024)
        check(ImageIO.write(image, "png", output)) { "COSMETIC_STUDIO_PNG_ENCODING_FAILED" }
        image.flush()
        return output.toByteArray().also { check(it.size <= MAX_PNG_BYTES) { "COSMETIC_STUDIO_PNG_TOO_LARGE" } }
    }

    data class DecodedConcept(val mediaType: String, val renderBytes: ByteArray, val image: BufferedImage)
    private data class Crop(val left: Int, val top: Int, val right: Int, val bottom: Int)
    private data class Pose(val x: Double, val y: Double, val rotation: Double, val scaleX: Double, val scaleY: Double)

    private fun crop(width: Int, height: Int, aspect: Double): Crop {
        val sourceAspect = width.toDouble() / height
        return if (sourceAspect > aspect) {
            val cropWidth = (height * aspect).toInt().coerceAtLeast(1)
            val left = (width - cropWidth) / 2
            Crop(left, 0, left + cropWidth, height)
        } else {
            val cropHeight = (width / aspect).toInt().coerceAtLeast(1)
            val top = (height - cropHeight) / 2
            Crop(0, top, width, top + cropHeight)
        }
    }

    private fun poseFor(motion: String, frame: Int, revision: Int): Pose {
        val phase = (frame - 1) / MOTION_COUNTS.getValue(motion).toDouble() * Math.PI * 2.0
        val revisionTurn = (revision % 7 - 3) * 0.012
        val revisionX = (revision % 9 - 4) * 1.25
        return when (motion) {
            "rest" -> Pose(kotlin.math.sin(phase) * 3.0 + revisionX, kotlin.math.cos(phase) * 3.0, kotlin.math.sin(phase) * 0.025 + revisionTurn, 1.0, 1.0)
            "run" -> Pose(kotlin.math.cos(phase) * 9.0 + revisionX, kotlin.math.sin(phase) * 9.0, kotlin.math.sin(phase) * 0.11 + revisionTurn, 1.0 + kotlin.math.cos(phase) * 0.04, 1.0 - kotlin.math.cos(phase) * 0.04)
            "strike1" -> Pose((frame - 2.5) * 8.0 + revisionX, kotlin.math.sin(phase) * 4.0, (frame - 2.5) * 0.08 + revisionTurn, 1.0 + frame * 0.016, 1.0 - frame * 0.01)
            "strike2" -> Pose(kotlin.math.sin(phase) * 6.0 + revisionX, (2.5 - frame) * 5.0, (frame - 2.5) * -0.1 + revisionTurn, 1.0 - frame * 0.01, 1.0 + frame * 0.018)
            else -> Pose(revisionX, 22.0 + (revision % 4) * 2.0, -0.48 + revisionTurn, 1.06, 0.78)
        }
    }

    private fun shapeFor(slot: String): Path2D.Double {
        val path = Path2D.Double()
        when (slot) {
            "HEAD" -> {
                path.moveTo(101.0, 185.0); path.curveTo(101.0, 150.0, 123.0, 120.0, 155.0, 113.0)
                path.curveTo(163.0, 80.0, 196.0, 61.0, 229.0, 70.0); path.curveTo(260.0, 77.0, 277.0, 103.0, 275.0, 132.0)
                path.curveTo(298.0, 141.0, 304.0, 159.0, 299.0, 176.0); path.curveTo(294.0, 193.0, 277.0, 201.0, 255.0, 198.0)
                path.lineTo(133.0, 198.0); path.curveTo(115.0, 198.0, 101.0, 194.0, 101.0, 185.0); path.closePath()
                path.moveTo(130.0, 199.0); path.lineTo(259.0, 192.0); path.lineTo(274.0, 210.0); path.quadTo(212.0, 225.0, 120.0, 215.0); path.closePath()
            }
            "TOP" -> {
                path.moveTo(142.0, 73.0); path.lineTo(171.0, 58.0); path.lineTo(207.0, 66.0); path.lineTo(241.0, 56.0)
                path.lineTo(275.0, 87.0); path.lineTo(298.0, 143.0); path.lineTo(264.0, 157.0); path.lineTo(251.0, 130.0)
                path.lineTo(247.0, 255.0); path.lineTo(137.0, 255.0); path.lineTo(133.0, 130.0); path.lineTo(117.0, 159.0)
                path.lineTo(84.0, 142.0); path.lineTo(109.0, 87.0); path.closePath()
            }
            "BOTTOM" -> {
                path.moveTo(120.0, 63.0); path.lineTo(264.0, 63.0); path.lineTo(256.0, 154.0); path.lineTo(243.0, 264.0)
                path.lineTo(196.0, 264.0); path.lineTo(191.0, 179.0); path.lineTo(180.0, 264.0); path.lineTo(130.0, 264.0)
                path.lineTo(126.0, 151.0); path.closePath()
            }
            "GLOVES" -> {
                path.moveTo(87.0, 153.0); path.quadTo(88.0, 123.0, 101.0, 113.0); path.quadTo(114.0, 107.0, 123.0, 123.0)
                path.lineTo(130.0, 83.0); path.quadTo(134.0, 66.0, 147.0, 70.0); path.quadTo(160.0, 73.0, 158.0, 91.0)
                path.lineTo(160.0, 59.0); path.quadTo(163.0, 43.0, 177.0, 48.0); path.quadTo(189.0, 52.0, 186.0, 72.0)
                path.lineTo(189.0, 49.0); path.quadTo(193.0, 36.0, 205.0, 44.0); path.quadTo(215.0, 50.0, 211.0, 72.0)
                path.lineTo(216.0, 57.0); path.quadTo(223.0, 45.0, 234.0, 53.0); path.quadTo(244.0, 62.0, 237.0, 82.0)
                path.lineTo(229.0, 115.0); path.quadTo(250.0, 99.0, 266.0, 110.0); path.quadTo(280.0, 120.0, 268.0, 138.0)
                path.lineTo(234.0, 188.0); path.quadTo(220.0, 210.0, 192.0, 212.0); path.lineTo(121.0, 207.0)
                path.quadTo(91.0, 203.0, 87.0, 153.0); path.closePath()
                path.moveTo(220.0, 217.0); path.quadTo(245.0, 208.0, 261.0, 224.0); path.lineTo(281.0, 244.0)
                path.quadTo(297.0, 263.0, 280.0, 276.0); path.quadTo(263.0, 287.0, 247.0, 270.0); path.lineTo(216.0, 247.0)
                path.quadTo(204.0, 235.0, 220.0, 217.0); path.closePath()
                path.moveTo(98.0, 235.0); path.quadTo(105.0, 213.0, 129.0, 216.0); path.lineTo(165.0, 220.0)
                path.quadTo(184.0, 226.0, 178.0, 245.0); path.quadTo(173.0, 262.0, 150.0, 256.0)
                path.lineTo(113.0, 255.0); path.quadTo(91.0, 259.0, 98.0, 235.0); path.closePath()
            }
            "SHOES" -> {
                path.moveTo(87.0, 197.0); path.quadTo(107.0, 189.0, 120.0, 166.0); path.lineTo(137.0, 91.0)
                path.quadTo(144.0, 72.0, 160.0, 76.0); path.quadTo(175.0, 80.0, 169.0, 102.0); path.lineTo(164.0, 168.0)
                path.quadTo(179.0, 194.0, 213.0, 199.0); path.lineTo(238.0, 209.0); path.quadTo(253.0, 217.0, 247.0, 234.0)
                path.quadTo(244.0, 248.0, 226.0, 250.0); path.lineTo(104.0, 250.0); path.quadTo(81.0, 249.0, 80.0, 229.0); path.closePath()
                path.moveTo(228.0, 214.0); path.quadTo(255.0, 203.0, 270.0, 182.0); path.lineTo(281.0, 121.0)
                path.quadTo(285.0, 100.0, 302.0, 105.0); path.quadTo(318.0, 111.0, 310.0, 132.0); path.lineTo(305.0, 184.0)
                path.quadTo(316.0, 205.0, 339.0, 210.0); path.lineTo(361.0, 217.0); path.quadTo(377.0, 225.0, 371.0, 241.0)
                path.quadTo(367.0, 254.0, 349.0, 255.0); path.lineTo(247.0, 253.0); path.quadTo(222.0, 249.0, 221.0, 231.0)
                path.quadTo(220.0, 220.0, 228.0, 214.0); path.closePath()
            }
            "CAPE" -> {
                path.moveTo(132.0, 65.0); path.quadTo(170.0, 85.0, 196.0, 66.0); path.lineTo(251.0, 64.0)
                path.lineTo(240.0, 127.0); path.quadTo(244.0, 180.0, 296.0, 253.0); path.quadTo(258.0, 241.0, 232.0, 266.0)
                path.quadTo(208.0, 248.0, 185.0, 267.0); path.quadTo(157.0, 242.0, 125.0, 264.0)
                path.quadTo(139.0, 205.0, 104.0, 144.0); path.closePath()
            }
        }
        return path
    }

    companion object {
        const val MAX_CONCEPT_BYTES = 8 * 1024 * 1024
        const val MAX_RENDER_SOURCE_BYTES = 2 * 1024 * 1024
        const val MAX_DIMENSION = 8_192
        const val MAX_PIXELS = 16_000_000L
        const val MAX_DECODE_PIXELS = 2_000_000L
        const val MAX_PNG_BYTES = 1024 * 1024
        const val RENDER_SOURCE_SIZE = 512
        const val SIZE = 384
        val SLOTS = listOf("HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE")
        val MOTION_COUNTS = linkedMapOf("rest" to 4, "run" to 4, "strike1" to 4, "strike2" to 4, "death" to 1)
        private val SLOT_TINT = mapOf(
            "HEAD" to Color(244, 184, 74), "TOP" to Color(95, 198, 214), "BOTTOM" to Color(138, 156, 255),
            "GLOVES" to Color(229, 139, 194), "SHOES" to Color(144, 214, 156), "CAPE" to Color(255, 136, 120),
        )
    }
}
