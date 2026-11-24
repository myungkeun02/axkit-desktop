// macOS icons from the app icon (design C, ax-kit-ios AppIcon icon-1024.png):
//   icon-mac.png   1024×1024: the art inside an 824 rounded square with margin and a soft shadow (macOS icon grid)
//   tray.png       menu bar template: the three clay bots as black silhouettes, eyes cut out (macOS tints it)
// Run: swift design/mac-icon.swift <icon-1024.png> <out folder>
import AppKit

let args = CommandLine.arguments
let src = NSImage(contentsOfFile: args[1])!.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let out = args[2]
let cs = CGColorSpace(name: CGColorSpace.sRGB)!

func write(_ img: CGImage, _ name: String) {
    let rep = NSBitmapImageRep(cgImage: img)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name)"))
}

// ---------- app icon ----------
do {
    let S: CGFloat = 1024, side: CGFloat = 824, radius: CGFloat = 185
    let ctx = CGContext(data: nil, width: Int(S), height: Int(S), bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    // CG origin is bottom-left: the square sits a little high so the shadow has room below.
    let rect = CGRect(x: (S - side) / 2, y: (S - side) / 2 + 10, width: side, height: side)
    let shape = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(gray: 0, alpha: 0.35))
    ctx.addPath(shape); ctx.setFillColor(CGColor(srgbRed: 0.16, green: 0.36, blue: 0.92, alpha: 1)); ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(shape); ctx.clip()
    ctx.draw(src, in: rect)
    ctx.restoreGState()
    write(ctx.makeImage()!, "icon-mac.png")
}

// ---------- menu bar template ----------
func squircle(_ r: CGRect, n: CGFloat = 2.25) -> CGPath {
    let p = CGMutablePath()
    for i in 0...240 {
        let t = CGFloat(i) / 240 * 2 * .pi
        let ct = cos(t), st = sin(t)
        let x = r.midX + r.width / 2 * (ct >= 0 ? 1 : -1) * pow(abs(ct), 2 / n)
        let y = r.midY + r.height / 2 * (st >= 0 ? 1 : -1) * pow(abs(st), 2 / n)
        i == 0 ? p.move(to: CGPoint(x: x, y: y)) : p.addLine(to: CGPoint(x: x, y: y))
    }
    p.closeSubpath()
    return p
}
do {
    // Same layout as design C (top-left coordinates in the 1024 art), cropped to the three bots.
    let W = 72, H = 48
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let crop = CGRect(x: 140, y: 320, width: 744, height: 510)
    let k = min(CGFloat(W) / crop.width, CGFloat(H) / crop.height)
    let ox = (CGFloat(W) - crop.width * k) / 2, oy = (CGFloat(H) - crop.height * k) / 2
    func map(_ r: CGRect) -> CGRect { // top-left art space → bottom-left context space
        CGRect(x: ox + (r.minX - crop.minX) * k, y: CGFloat(H) - oy - (r.maxY - crop.minY) * k, width: r.width * k, height: r.height * k)
    }
    func eyes(_ cx: CGFloat, _ cy: CGFloat, gap: CGFloat, w: CGFloat, h: CGFloat) {
        ctx.setBlendMode(.clear)
        for dx in [-gap / 2, gap / 2] {
            let r = map(CGRect(x: cx + dx - w / 2, y: cy - h / 2, width: w, height: h))
            ctx.addPath(CGPath(roundedRect: r, cornerWidth: r.width / 2, cornerHeight: r.width / 2, transform: nil)); ctx.fillPath()
        }
        ctx.setBlendMode(.normal)
    }
    ctx.setFillColor(CGColor(gray: 0, alpha: 1))
    ctx.addPath(squircle(map(CGRect(x: 150, y: 330, width: 330, height: 300)))); ctx.fillPath()
    eyes(315, 480, gap: 96, w: 40, h: 70)
    ctx.addPath(squircle(map(CGRect(x: 544, y: 330, width: 330, height: 300)))); ctx.fillPath()
    eyes(709, 480, gap: 96, w: 40, h: 70)
    // A clear gap around the front bot so the three read as three.
    let front = squircle(map(CGRect(x: 292, y: 420, width: 440, height: 400)))
    ctx.setBlendMode(.clear); ctx.setLineWidth(3.6); ctx.addPath(front); ctx.strokePath(); ctx.setBlendMode(.normal)
    ctx.addPath(front); ctx.fillPath()
    eyes(512, 620, gap: 130, w: 54, h: 92)
    write(ctx.makeImage()!, "tray.png")
}
