import CoreGraphics
let x = Double(CommandLine.arguments[1])!, y = Double(CommandLine.arguments[2])!
CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
CGAssociateMouseAndMouseCursorPosition(1)
print("warped")
