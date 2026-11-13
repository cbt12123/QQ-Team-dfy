extends Node

signal changed(message: String)
signal progress(downloaded: int, total: int)

const BASE = "https://qqbot-public-web-test.onrender.com"
const PACKAGE = "com.dafeyu.pet"
const MAX_SIZE = 120 * 1024 * 1024
var release: Dictionary = {}
var artifact: Dictionary = {}
var request: HTTPRequest
var downloading := false
var verified_path := ""
var partial_path := ""
var version: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://version.json"))

func validate_release(value: Variant, architecture: String) -> Dictionary:
    if not value is Dictionary:
        return {"ok": false}
    var code = value.get("version_code", 0)
    if not (code is int or code is float) or code <= 0 or code != floor(code):
        return {"ok": false}
    if value.get("package_name") != PACKAGE or not value.get("version_name") is String or value.version_name.is_empty() or value.version_name.length() > 40:
        return {"ok": false}
    var items = value.get("artifacts", {})
    if not items is Dictionary or not items.get(architecture) is Dictionary:
        return {"ok": false}
    var item: Dictionary = items[architecture]
    var filename := "dafeyu-android.apk" if architecture == "arm64" else "dafeyu-android-x86_64.apk"
    if architecture not in ["arm64", "x86_64"] or item.get("url") != BASE + "/downloads/" + filename:
        return {"ok": false}
    var size = item.get("size", 0)
    if not (size is int or size is float) or size <= 0 or size > MAX_SIZE or size != floor(size):
        return {"ok": false}
    var hash_value = item.get("sha256", "")
    var pattern := RegEx.new()
    pattern.compile("^[a-fA-F0-9]{64}$")
    if not hash_value is String or pattern.search(hash_value) == null:
        return {"ok": false}
    return {"ok": true, "artifact": item}

func verify_file(path: String, size: int, sha256: String) -> bool:
    var file := FileAccess.open(path, FileAccess.READ)
    if file == null or file.get_length() != size:
        return false
    file.close()
    return FileAccess.get_sha256(path).to_lower() == sha256.to_lower()

func _make_request() -> HTTPRequest:
    var result := HTTPRequest.new()
    result.max_redirects = 0
    result.timeout = 60
    add_child(result)
    return result

func check_update() -> void:
    if is_instance_valid(request):
        return
    release = {}
    artifact = {}
    verified_path = ""
    changed.emit("正在检查更新；服务器首次唤醒可能需要约一分钟…")
    request = _make_request()
    request.body_size_limit = 256 * 1024
    request.request_completed.connect(_checked)
    if request.request(BASE + "/api/app/version", ["Accept: application/json"]) != OK:
        _release_request()
        changed.emit("无法检查更新，请稍后重试。")

func _release_request() -> void:
    if is_instance_valid(request):
        request.queue_free()
    request = null

func _checked(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
    _release_request()
    var value = JSON.parse_string(body.get_string_from_utf8())
    var checked := validate_release(value, Engine.get_architecture_name())
    if result != HTTPRequest.RESULT_SUCCESS or code != 200 or not checked.ok:
        changed.emit("检查失败或版本信息不可信，请稍后重试。")
        return
    if int(value.version_code) <= int(version.version_code):
        changed.emit("已经是最新版本（" + str(version.version_name) + "）。")
        return
    release = value
    artifact = checked.artifact
    var notes = value.get("release_notes", "")
    changed.emit("发现新版 " + str(value.version_name) + "，约 %.1f MB。" % (float(artifact.size) / 1048576.0) + ("\n" + notes.left(1000) if notes is String else ""))

func download_update() -> void:
    if artifact.is_empty() or is_instance_valid(request):
        return
    var folder := "user://updates"
    if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(folder)) != OK:
        changed.emit("无法创建更新目录。")
        return
    partial_path = folder + "/update.apk.part"
    verified_path = ""
    request = _make_request()
    request.timeout = 300
    request.download_file = partial_path
    request.body_size_limit = int(artifact.size)
    request.request_completed.connect(_downloaded)
    downloading = true
    changed.emit("正在下载更新…")
    if request.request(str(artifact.url)) != OK:
        cancel()
        changed.emit("下载无法开始，请稍后重试。")

func _process(_delta: float) -> void:
    if downloading and is_instance_valid(request):
        progress.emit(request.get_downloaded_bytes(), int(artifact.size))

func _downloaded(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
    downloading = false
    _release_request()
    if result != HTTPRequest.RESULT_SUCCESS or code != 200 or not verify_file(partial_path, int(artifact.size), str(artifact.sha256)):
        _remove_partial()
        changed.emit("下载失败或校验不通过，请重新下载。")
        return
    var target := "user://updates/update.apk"
    if DirAccess.rename_absolute(ProjectSettings.globalize_path(partial_path), ProjectSettings.globalize_path(target)) != OK:
        _remove_partial()
        changed.emit("无法保存安装包，请重新下载。")
        return
    verified_path = target
    changed.emit("下载并校验完成，点击安装更新。")

func _remove_partial() -> void:
    if not partial_path.is_empty():
        DirAccess.remove_absolute(ProjectSettings.globalize_path(partial_path))

func cancel() -> void:
    if is_instance_valid(request):
        request.cancel_request()
    _release_request()
    downloading = false
    _remove_partial()
    changed.emit("已取消，可重新检查或下载。")

func install_update() -> void:
    if verified_path.is_empty() or not verify_file(verified_path, int(artifact.size), str(artifact.sha256)):
        changed.emit("请先下载并校验更新。")
        return
    if not Engine.has_singleton("AndroidRuntime"):
        changed.emit("请在 Android App 内安装更新。")
        return
    var runtime = Engine.get_singleton("AndroidRuntime")
    runtime.getActivity().runOnUiThread(runtime.createRunnableFromGodotCallable(_open_installer))

func _open_installer() -> void:
    var activity = Engine.get_singleton("AndroidRuntime").getActivity()
    var Intent = JavaClassWrapper.wrap("android.content.Intent")
    var Uri = JavaClassWrapper.wrap("android.net.Uri")
    var BuildVersion = JavaClassWrapper.wrap("android.os.Build$VERSION")
    if BuildVersion.SDK_INT >= 26 and not activity.getPackageManager().canRequestPackageInstalls():
        var permission = Intent.Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES")
        permission.setData(Uri.parse("package:" + PACKAGE))
        activity.startActivity(permission)
        call_deferred("emit_signal", "changed", "请允许此 App 安装应用，返回后再点‘安装更新’。")
        return
    var File = JavaClassWrapper.wrap("java.io.File")
    var Provider = JavaClassWrapper.wrap("androidx.core.content.FileProvider")
    var file = File.File(ProjectSettings.globalize_path(verified_path))
    var uri = Provider.getUriForFile(activity, PACKAGE + ".fileprovider", file)
    var intent = Intent.Intent("android.intent.action.VIEW")
    intent.setDataAndType(uri, "application/vnd.android.package-archive")
    intent.addFlags(1)
    activity.startActivity(intent)
    if JavaClassWrapper.get_exception() != null:
        call_deferred("emit_signal", "changed", "无法打开系统安装器，请重试。")
    else:
        call_deferred("emit_signal", "changed", "请在系统窗口确认安装；已有云端账号和记忆会保留。")
