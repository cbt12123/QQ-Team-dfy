extends SceneTree

class OfflineApi extends "res://api_client.gd":
    var requests: Array = []
    var expired := false

    func request_json(method: int, path: String, body: Dictionary = {}) -> Dictionary:
        if expired: return {"ok": false, "error": "请先登录", "status": 401}
        requests.append({"method": method, "path": path, "body": body.duplicate()})
        return {"ok": false, "error": "离线测试：服务暂不可用", "status": 503}

    func stream_message(_body: Dictionary, on_delta: Callable) -> Dictionary:
        if expired: return {"ok": false, "error": "请先登录", "status": 401}
        await get_tree().process_frame
        on_delta.call("你好")
        await get_tree().process_frame
        on_delta.call("呀")
        return {"ok": true, "data": {}, "status": 200}

var room: Control

func _init() -> void:
    call_deferred("run")

func tap(control: Control) -> void:
    for pressed in [true, false]:
        var event := InputEventScreenTouch.new()
        event.index = 0
        event.position = control.get_global_rect().get_center()
        event.pressed = pressed
        Input.parse_input_event(event)
        await process_frame

func run() -> void:
    root.size = Vector2i(540, 1200)
    room = load("res://main.tscn").instantiate()
    root.add_child(room)
    await process_frame
    await process_frame
    room._show_page("settings")
    await process_frame
    for field in [room.username_input, room.password_input]:
        field.text = ""
        await tap(field)
        assert(field.has_focus(), "Touch must focus " + field.placeholder_text)
        var key := InputEventKey.new()
        key.pressed = true
        key.unicode = 116
        Input.parse_input_event(key)
        await process_frame
        assert(field.text == "t", "Focused field must accept keyboard input")
    var original_api = room.api
    room.api = OfflineApi.new()
    room.add_child(room.api)
    original_api.queue_free()
    await room._authenticate(true)
    assert(room.api.requests.is_empty(), "Invalid credentials must fail before a request")
    assert("用户名至少3位" in room.auth_label.text)
    for registering in [true, false]:
        room.username_input.text = "offline-user"
        room.password_input.text = "offline-password-123"
        await room._authenticate(registering)
        var request: Dictionary = room.api.requests.back()
        assert(request.method == HTTPClient.METHOD_POST)
        assert(request.path == ("/api/register" if registering else "/api/login"))
        assert(request.body.username == "offline-user")
        assert(request.body.password == "offline-password-123")
        if registering:
            assert(not request.body.has("invite"))
        assert(room.auth_label.text == "离线测试：服务暂不可用", "Display the actual API error at the default domain")
    assert(room.api.requests.size() == 2)
    assert(not room.busy)
    room._show_page("chat")
    await process_frame
    await tap(room.chat_input)
    assert(room.chat_input.has_focus(), "Touch must focus chat entry")
    room._apply_keyboard_inset(430)
    await process_frame
    await process_frame
    assert(room.chat_input.get_global_rect().end.y < 1200 - 430, "Chat entry must stay above the soft keyboard")
    room._apply_keyboard_inset(0)
    room.user = {"username": "bubble-test"}
    room.chat_input.text = "测试消息"
    room._send_message()
    assert(room.chat_input.text.is_empty(), "Sending clears composer immediately")
    assert(room.chat_rows.get_child_count() == 2, "User and thinking bubbles appear immediately")
    assert(room.send_button.disabled)
    await process_frame
    await process_frame
    await process_frame
    assert("你好呀" in room.chat_log.text, "Streaming delta text is appended incrementally")
    assert(not room.send_button.disabled)
    room._logout()
    assert(room.chat_rows.get_child_count() == 0)
    assert(room.login_form.visible and not room.account_panel.visible)
    assert(room.pages.has("personality"))
    room.api.expired = true
    for operation in ["history", "send"]:
        room.user = {"username": "expired-test"}
        room.api.cookie = "expired-cookie"
        room.login_form.visible = false
        room.account_panel.visible = true
        room._append_bubble("assistant", "private expired history")
        if operation == "history":
            await room._load_history(room.api.generation)
        else:
            room.chat_input.text = "expired send"
            await room._send_message()
        assert(room.user.is_empty() and room.api.cookie.is_empty(), "401 must clear identity and cookie: " + operation)
        assert(room.login_form.visible and not room.account_panel.visible, "401 must restore login: " + operation)
        assert(room.current_page == "settings")
        assert(room.chat_rows.get_child_count() == 0 and room.chat_log.text.is_empty(), "401 must clear private messages")
        assert("登录已失效" in room.auth_label.text)
    await process_frame
    room.queue_free()
    await process_frame
    print("PASS: touch focuses all account fields and chat; typed input reaches fields")
    quit(0)
