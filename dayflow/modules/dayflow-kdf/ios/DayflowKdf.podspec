Pod::Spec.new do |s|
  s.name           = 'DayflowKdf'
  s.version        = '1.0.0'
  s.summary        = 'PBKDF2-HMAC-SHA256 through CommonCrypto'
  s.description    = 'Derives the account key in native code, which Hermes cannot do quickly.'
  s.license        = 'MIT'
  s.author         = 'Tewodros Ashenafi'
  s.homepage       = 'https://github.com/twdashenafi-beep/Claude'
  s.platforms      = {
    :ios => '16.4',
    :osx => '13.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
