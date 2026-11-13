extends Node

const PREVIEW_BASE = "https://qqbot-public-web-test.onrender.com"
var base_url: String = PREVIEW_BASE
var cookie: String = ""
var generation: int = 0
var active: int = 0
var stream_clients: Array[HTTPClient] = []

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
    for client in stream_clients:
        client.close()

func stream_message(body: Dictionary, on_delta: Callable) -> Dictionary:
    if active >= 3:
        return {"ok": false, "error": "请求正在处理中，请稍等", "status": 0}
    if not valid_base(base_url):
        return {"ok": false, "error": "服务器地址无效", "status": 0}
    var client := HTTPClient.new()
    stream_clients.append(client)
    active += 1
    var result := await _stream_message(client, generation, body, on_delta)
    client.close()
    stream_clients.erase(client)
    active -= 1
    return result

func _stream_message(client: HTTPClient, version: int, body: Dictionary, on_delta: Callable) -> Dictionary:
    var secure := base_url.begins_with("https://")
    var authority := base_url.substr(8 if secure else 7).split(":")
    var port := int(authority[1]) if authority.size() > 1 else (443 if secure else 80)
    var started := client.connect_to_host(authority[0], port, TLSOptions.client() if secure else null)
    if started != OK:
        return {"ok": false, "error": "无法开始网络请求", "status": 0}
    var deadline := Time.get_ticks_msec() + 90000
    var sent := false
    var received_headers := false
    var status := 0
    var pending := PackedByteArray()
    var total := 0
    var event_name := ""
    var data_lines := PackedStringArray()
    while Time.get_ticks_msec() < deadline:
        if version != generation:
            return {"ok": false, "cancelled": true, "error": "账号状态已改变，此结果已丢弃", "status": 0}
        var polled := client.poll()
        if polled != OK:
            break
        var state := client.get_status()
        if state == HTTPClient.STATUS_CONNECTED and not sent:
            var headers := PackedStringArray(["Content-Type: application/json", "Accept: text/event-stream", "X-Pet-Request: 1"])
            if not cookie.is_empty():
                headers.append("Cookie: " + cookie)
            if client.request(HTTPClient.METHOD_POST, "/api/messages/stream", headers, JSON.stringify(body)) != OK:
                break
            sent = true
        if client.has_response() and not received_headers:
            received_headers = true
            status = client.get_response_code()
            if status < 200 or status >= 300:
                return {"ok": false, "error": "流式请求失败（HTTP %d）" % status, "status": status}
            var content_type := ""
            for header in client.get_response_headers():
                if header.to_lower().begins_with("content-type:"):
                    content_type = header.substr(header.find(":") + 1).strip_edges().to_lower()
            if not content_type.begins_with("text/event-stream"):
                return {"ok": false, "error": "服务器未返回流式内容", "status": status}
        if state == HTTPClient.STATUS_BODY:
            var chunk := client.read_response_body_chunk()
            total += chunk.size()
            if total > 2 * 1024 * 1024:
                return {"ok": false, "error": "服务器响应过大", "status": status}
            pending.append_array(chunk)
            # Decode only complete lines so split UTF-8 codepoints remain intact.
            var newline := pending.find(10)
            while newline >= 0:
                var line := pending.slice(0, newline).get_string_from_utf8().trim_suffix("\r")
                pending = pending.slice(newline + 1)
                if line.is_empty():
                    if not data_lines.is_empty():
                        var data = JSON.parse_string("\n".join(data_lines))
                        if not data is Dictionary:
                            return {"ok": false, "error": "服务器返回了无法识别的事件", "status": status}
                        if event_name == "delta":
                            if not data.get("text") is String:
                                return {"ok": false, "error": "服务器返回了无效的文本", "status": status}
                            if on_delta.is_valid():
                                on_delta.call(data.text)
                            if version != generation:
                                return {"ok": false, "cancelled": true, "error": "账号状态已改变，此结果已丢弃", "status": 0}
                        elif event_name == "done":
                            return {"ok": true, "data": data, "status": status}
                        elif event_name == "error":
                            return {"ok": false, "error": str(data.get("error", "服务暂不可用")), "status": status}
                    event_name = ""
                    data_lines.clear()
                elif not line.begins_with(":"):
                    var colon := line.find(":")
                    var field := line if colon < 0 else line.substr(0, colon)
                    var value := "" if colon < 0 else line.substr(colon + 1).trim_prefix(" ")
                    if field == "event":
                        event_name = value
                    elif field == "data":
                        data_lines.append(value)
                newline = pending.find(10)
        elif state in [HTTPClient.STATUS_CANT_RESOLVE, HTTPClient.STATUS_CANT_CONNECT, HTTPClient.STATUS_CONNECTION_ERROR, HTTPClient.STATUS_TLS_HANDSHAKE_ERROR, HTTPClient.STATUS_DISCONNECTED]:
            break
        elif received_headers and state == HTTPClient.STATUS_CONNECTED:
            break
        await get_tree().process_frame
    return {"ok": false, "error": "流式连接中断或超时，请重试", "status": status}

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
