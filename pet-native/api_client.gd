extends Node

const PREVIEW_BASE = "https://qqbot-public-web-test.onrender.com"
var base_url: String = PREVIEW_BASE
var cookie: String = ""
var generation: int = 0
var active: int = 0

func valid_base(value: String) -> bool:
    var pattern := RegEx.new()
    pattern.compile("^https://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$")
    if pattern.search(value) != null:
        return true
    pattern.compile("^http://(?:127\\.0\\.0\\.1|localhost|10\\.0\\.2\\.2)(?::[0-9]{1,5})?$")
    return pattern.search(value) != null

func set_base(value: String) -> bool:
    value = value.strip_edges().trim_suffix("/")
    if not valid_base(value):
        return false
    if value != base_url:
        invalidate()
        base_url = value
    return true

func invalidate() -> void:
    generation += 1
    cookie = ""

func request_json(method: int, path: String, body: Dictionary = {}) -> Dictionary:
    if active >= 3:
        return {"ok": false, "error": "请求正在处理中，请稍等", "status": 0}
    var version := generation
    var request := HTTPRequest.new()
    request.timeout = 60.0
    request.max_redirects = 0
    request.body_size_limit = 2 * 1024 * 1024
    add_child(request)
    var headers := PackedStringArray(["Content-Type: application/json", "X-Pet-Request: 1"])
    if not cookie.is_empty():
        headers.append("Cookie: " + cookie)
    active += 1
    var started := request.request(base_url + path, headers, method, "" if method == HTTPClient.METHOD_GET else JSON.stringify(body))
    if started != OK:
        active -= 1
        request.queue_free()
        return {"ok": false, "error": "无法开始网络请求", "status": 0}
    var result: Array = await request.request_completed
    active -= 1
    request.queue_free()
    if version != generation:
        return {"ok": false, "cancelled": true, "error": "账号状态已改变，此结果已丢弃", "status": 0}
    if result[0] != HTTPRequest.RESULT_SUCCESS:
        return {"ok": false, "error": "连接失败，请检查网络和服务器地址", "status": 0}
    var data = JSON.parse_string(result[3].get_string_from_utf8())
    if not data is Dictionary:
        return {"ok": false, "error": "服务器返回了无法识别的内容", "status": result[1]}
    if result[1] >= 200 and result[1] < 300:
        for header in result[2]:
            if header.to_lower().begins_with("set-cookie: pet_session="):
                cookie = header.substr(header.find(":") + 1).strip_edges().split(";")[0]
        return {"ok": true, "data": data, "status": result[1]}
    return {"ok": false, "error": str(data.get("error", "服务暂不可用")), "status": result[1]}

func logout_remotely() -> void:
    if not cookie.is_empty():
        var request := HTTPRequest.new()
        add_child(request)
        request.timeout = 8
        request.max_redirects = 0
        request.request_completed.connect(func(_a, _b, _c, _d): request.queue_free())
        var started := request.request(base_url + "/api/logout", PackedStringArray(["Content-Type: application/json", "X-Pet-Request: 1", "Cookie: " + cookie]), HTTPClient.METHOD_POST, "{}")
        if started != OK:
            request.queue_free()
    invalidate()
