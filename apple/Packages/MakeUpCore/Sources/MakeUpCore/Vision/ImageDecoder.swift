import CoreGraphics
import Foundation
import ImageIO

public enum ImageDecoder {
    /// Decodes with the EXIF orientation baked in — otherwise landmarks land on
    /// a differently-oriented image than the one the user sees. The original file stays intact locally; the working copy is capped at 4096
    /// pixels to keep GPU memory bounded while preserving detail during zoom.
    public static func decode(_ data: Data, maxPixelSize: Int = 4096) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
