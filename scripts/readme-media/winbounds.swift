import CoreGraphics
import Foundation
let want = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "weekpage"
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
  if owner.lowercased().contains(want.lowercased()) {
    let b = w[kCGWindowBounds as String] as! [String: Any]
    let id = w[kCGWindowNumber as String] as! Int
    let layer = w[kCGWindowLayer as String] as! Int
    print("\(id) \(owner) layer=\(layer) \(b["X"]!) \(b["Y"]!) \(b["Width"]!) \(b["Height"]!)")
  }
}
