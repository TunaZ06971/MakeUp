import Accelerate
import CoreGraphics
import Foundation

/// Feathering and normalisation for the single-channel coverage masks.
enum MaskBlur {
    /// Approximates a Gaussian with vImage's box blur, which is what Core Image
    /// does internally and is far cheaper than a true convolution at this size.
    static func apply(to image: CGImage, radius: CGFloat, size: Int) -> CGImage? {
        guard var source = try? vImage_Buffer(cgImage: image) else { return nil }
        defer { source.free() }

        guard var destination = try? vImage_Buffer(
            width: size, height: size, bitsPerPixel: 8
        ) else { return nil }
        defer { destination.free() }

        // vImage requires an odd kernel width.
        var kernel = UInt32(radius * 2)
        if kernel % 2 == 0 { kernel += 1 }

        let error = vImageBoxConvolve_Planar8(
            &source, &destination, nil, 0, 0, kernel, kernel, 0,
            vImage_Flags(kvImageEdgeExtend)
        )
        guard error == kvImageNoError else { return nil }

        return makeImage(from: &destination, size: size)
    }

    /// Rescales the mask so its strongest point reaches full opacity.
    ///
    /// Blurring a narrow region — an eyelid, a lash line — spreads its coverage
    /// out and leaves the whole mask semi-transparent, which silently caps how
    /// much product can ever be applied there. Normalising keeps feather a purely
    /// cosmetic edge treatment: intensity 100% means 100% everywhere.
    static func normalisePeak(_ image: CGImage, size: Int) -> CGImage? {
        guard var buffer = try? vImage_Buffer(cgImage: image) else { return nil }
        defer { buffer.free() }

        let pixels = buffer.data!.assumingMemoryBound(to: UInt8.self)
        let rowBytes = Int(buffer.rowBytes)
        let width = Int(buffer.width)
        let height = Int(buffer.height)

        // vImage pads each row for alignment. Scanning the padding would let a
        // stray byte pin the peak at 255 and silently skip the rescale — the
        // exact failure that made eyeshadow almost invisible on the web client.
        var peak: UInt8 = 0
        for row in 0..<height {
            let start = row * rowBytes
            for column in 0..<width where pixels[start + column] > peak {
                peak = pixels[start + column]
            }
        }
        guard peak > 0, peak < 255 else { return image }

        let gain = 255.0 / Double(peak)
        for row in 0..<height {
            let start = row * rowBytes
            for column in 0..<width {
                let index = start + column
                pixels[index] = UInt8(min(255, Int(Double(pixels[index]) * gain)))
            }
        }
        return makeImage(from: &buffer, size: size)
    }

    private static func makeImage(from buffer: inout vImage_Buffer, size: Int) -> CGImage? {
        guard let context = CGContext(
            data: buffer.data,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: buffer.rowBytes,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }
        return context.makeImage()
    }
}
