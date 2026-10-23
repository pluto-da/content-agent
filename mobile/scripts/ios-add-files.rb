# 1.0：把原生 Swift 文件加入 Capacitor iOS 工程的 App target（幂等）。用法：ruby ios-add-files.rb <App.xcodeproj> <file.swift>...
# 依赖 xcodeproj gem（GitHub macOS runner 随 CocoaPods 自带；本机可 gem install xcodeproj）。
require 'xcodeproj'
proj_path = ARGV.shift
proj = Xcodeproj::Project.open(proj_path)
target = proj.targets.find { |t| t.name == 'App' } or abort('没有 App target')
group = proj.main_group.find_subpath('App', false) or abort('没有 App 分组')
ARGV.each do |f|
  ref = group.files.find { |x| x.path == f } || group.new_reference(f)
  unless target.source_build_phase.files_references.include?(ref)
    target.add_file_references([ref])
    puts "已加入 App target：#{f}"
  end
end
proj.save
