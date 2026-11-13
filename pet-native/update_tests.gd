extends SceneTree

func _init() -> void:
    var updater = load("res://app_updater.gd").new()
    var manifest := {
        "package_name": "com.dafeyu.pet", "version_code": 6, "version_name": "0.2.1", "release_notes": "test",
        "artifacts": {"x86_64": {"url": "https://qqbot-public-web-test.onrender.com/downloads/dafeyu-android-x86_64.apk", "sha256": "a".repeat(64), "size": 100}}
    }
    assert(updater.validate_release(manifest, "x86_64").ok)
    var bad: Dictionary = manifest.duplicate(true)
    bad.package_name = "evil.package"
    assert(not updater.validate_release(bad, "x86_64").ok)
    bad = manifest.duplicate(true)
    bad.artifacts.x86_64.url = "https://evil.example/app.apk"
    assert(not updater.validate_release(bad, "x86_64").ok)
    bad = manifest.duplicate(true)
    bad.artifacts.x86_64.sha256 = "invalid"
    assert(not updater.validate_release(bad, "x86_64").ok)
    bad = manifest.duplicate(true)
    bad.artifacts.x86_64.size = 0
    assert(not updater.validate_release(bad, "x86_64").ok)
    bad = manifest.duplicate(true)
    bad.version_code = 6.5
    assert(not updater.validate_release(bad, "x86_64").ok)
    assert(not updater.validate_release(manifest, "arm64").ok)
    var file := "res://../.cache/updater-test.apk"
    var handle := FileAccess.open(file, FileAccess.WRITE)
    handle.store_string("test-package")
    handle.close()
    var size := 12
    var hash := FileAccess.get_sha256(file)
    assert(updater.verify_file(file, size, hash))
    assert(not updater.verify_file(file, size + 1, hash))
    assert(not updater.verify_file(file, size, "a".repeat(64)))
    updater.partial_path = file
    updater.artifact = {"size": size, "sha256": "a".repeat(64)}
    updater._downloaded(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), PackedByteArray())
    assert(not FileAccess.file_exists(file), "Corrupt downloads must be removed")
    assert(updater.verified_path.is_empty(), "Corrupt downloads must never become installable")
    handle = FileAccess.open(file, FileAccess.WRITE)
    handle.store_string("partial")
    handle.close()
    updater.cancel()
    assert(not FileAccess.file_exists(file), "Cancellation must remove partial downloads")
    updater.free()
    print("PASS: update source/package/version/size/hash validation, file verification and failed/cancelled download cleanup")
    quit(0)
