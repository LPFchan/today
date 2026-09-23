// Renders mac/Resources/AppIcon.icns: public/icon.svg (a white clock on
// marie's blue) on the macOS icon grid. Run: swift mac/scripts/make-icon.swift
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let iconset = FileManager.default.temporaryDirectory.appending(path: "AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px) / 1024
    // macOS icon grid: an 824 pt rounded square centred on a 1024 pt canvas.
    let box = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
    let shape = NSBezierPath(roundedRect: box, xRadius: 185 * s, yRadius: 185 * s)
    NSGradient(starting: NSColor(red: 0.36, green: 0.49, blue: 0.97, alpha: 1),
               ending: NSColor(red: 0.15, green: 0.27, blue: 0.82, alpha: 1))!.draw(in: shape, angle: -90)
    // The SVG's 64-unit grid, scaled onto the square. Drawn by hand: Apple's
    // licence doesn't allow SF Symbols in app icons.
    let u = 824 * s / 64, c = NSPoint(x: 512 * s, y: 512 * s)
    NSColor.white.setStroke()
    let ring = NSBezierPath(ovalIn: NSRect(x: c.x - 18 * u, y: c.y - 18 * u, width: 36 * u, height: 36 * u))
    ring.lineWidth = 5 * u
    ring.stroke()
    let hands = NSBezierPath()
    hands.move(to: NSPoint(x: c.x, y: c.y + 11 * u))
    hands.line(to: c)
    hands.line(to: NSPoint(x: c.x + 7 * u, y: c.y - 5 * u))
    hands.lineWidth = 5 * u
    hands.lineCapStyle = .round
    hands.lineJoinStyle = .round
    hands.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for points in [16, 32, 128, 256, 512] {
    try! render(points).write(to: iconset.appending(path: "icon_\(points)x\(points).png"))
    try! render(points * 2).write(to: iconset.appending(path: "icon_\(points)x\(points)@2x.png"))
}
let out = root.appending(path: "Resources/AppIcon.icns")
try! FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", out.path]
try! task.run()
task.waitUntilExit()
print(out.path)
