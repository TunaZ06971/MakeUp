import Foundation

extension ProductColor {
    /// Parsed `#RRGGBB` as 0...1 components. The shader pipeline needs the raw
    /// numbers, not a platform color type, so this lives beside the model.
    public var rgb: (red: Double, green: Double, blue: Double)? {
        let hexDigits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard hexDigits.count == 6, let value = UInt32(hexDigits, radix: 16) else { return nil }
        return (
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
