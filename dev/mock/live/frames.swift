// Fake pages for the mock's browser-live (§22): a shop login form and the page after logging in.
// 824×1720 JPEGs, like the server's (412×860 CSS px drawn at 2×). Run: swift frames.swift <folder>
import AppKit

let W: CGFloat = 824, H: CGFloat = 1720
func page(_ name: String, _ draw: (CGContext) -> Void) {
    let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.translateBy(x: 0, y: H); ctx.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    ctx.setFillColor(.white); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    draw(ctx)
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: "\(CommandLine.arguments[1])/\(name).jpg"))
}
func text(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ color: NSColor = .black, bold: Bool = false) {
    (s as NSString).draw(at: CGPoint(x: x, y: y), withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular), .foregroundColor: color])
}
func box(_ c: CGContext, _ r: CGRect, fill: NSColor, stroke: NSColor? = nil) {
    let p = CGPath(roundedRect: r, cornerWidth: 16, cornerHeight: 16, transform: nil)
    c.addPath(p); c.setFillColor(fill.cgColor); c.fillPath()
    if let stroke { c.addPath(p); c.setStrokeColor(stroke.cgColor); c.setLineWidth(3); c.strokePath() }
}
let blue = NSColor(srgbRed: 0.1, green: 0.4, blue: 0.95, alpha: 1)
func header(_ c: CGContext) {
    c.setFillColor(NSColor(white: 0.96, alpha: 1).cgColor); c.fill(CGRect(x: 0, y: 0, width: W, height: 140))
    text("가나다 상점", 48, 44, 48, blue, bold: true)
}
page("login") { c in
    header(c)
    text("로그인", 48, 220, 64, bold: true)
    text("아이디", 48, 360, 34, .darkGray)
    box(c, CGRect(x: 48, y: 410, width: 728, height: 110), fill: .white, stroke: .lightGray)
    text("비밀번호", 48, 570, 34, .darkGray)
    box(c, CGRect(x: 48, y: 620, width: 728, height: 110), fill: .white, stroke: .lightGray)
    box(c, CGRect(x: 48, y: 800, width: 728, height: 120), fill: blue)
    text("로그인", 340, 832, 44, .white, bold: true)
    text("가짜 맥의 시험 페이지예요.", 48, 1000, 30, .gray)
}
page("done") { c in
    header(c)
    text("로그인했어요", 48, 220, 64, bold: true)
    text("장바구니: 원두 5kg · 145,000원", 48, 360, 36)
    box(c, CGRect(x: 48, y: 460, width: 728, height: 120), fill: blue)
    text("주문하기", 320, 492, 44, .white, bold: true)
    text("결제는 오너가 직접 눌러요.", 48, 640, 30, .gray)
}
