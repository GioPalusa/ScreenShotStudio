// Render Apple's system symbols as monochrome masks for the Mac editor.
// Regenerate on macOS: swift tools/export-symbols.swift app/icons
import AppKit

let names = [
    "align.horizontal.left", "align.horizontal.center", "align.horizontal.right",
    "align.vertical.top", "align.vertical.center", "align.vertical.bottom",
    "distribute.horizontal.center", "distribute.vertical.center",
    "text.alignleft", "text.aligncenter", "text.alignright", "line.3.horizontal",
    "square.on.square", "square.stack.3d.up", "trash", "eye", "eye.slash",
    "lock", "lock.open", "textformat", "photo", "iphone", "square",
    "rectangle.3.group", "square.dashed", "arrow.uturn.backward", "arrow.uturn.forward"
]
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for name in names {
    guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(.init(pointSize: 20, weight: .regular)),
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 72, pixelsHigh: 72,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("System symbol unavailable: \(name)")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    let scale = min(60 / image.size.width, 60 / image.size.height)
    let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
    image.draw(in: NSRect(x: (72 - size.width) / 2, y: (72 - size.height) / 2,
                         width: size.width, height: size.height))
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("\(name).png"))
}
print("Exported \(names.count) system symbols.")
