extends SceneTree

class OfflineApi extends "res://api_client.gd":
    var requests: Array = []

    func request_json(method: int, path: String, body: Dictionary = {}) -> Dictionary:
        requests.append({"method": method, "path": path, "body": body.duplicate()})
        return {"ok": false, "error": "离线测试：服务暂不可用", "status": 503}

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
    for field in [room.username_input, room.password_input, room.invite_input, room.server_input]:
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
    room.server_input.text = room.api.PREVIEW_BASE
    await room._authenticate(true)
    assert(room.api.requests.is_empty(), "Invalid credentials must fail before a request")
    assert("用户名至少3位" in room.auth_label.text)
    for registering in [true, false]:
        room.username_input.text = "offline-user"
        room.password_input.text = "offline-password-123"
        room.invite_input.text = "offline-invite"
        await room._authenticate(registering)
        var request: Dictionary = room.api.requests.back()
        assert(request.method == HTTPClient.METHOD_POST)
        assert(request.path == ("/api/register" if registering else "/api/login"))
        assert(request.body.username == "offline-user")
        assert(request.body.password == "offline-password-123")
        if registering:
            assert(request.body.invite == "offline-invite")
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
    room.queue_free()
    await process_frame
    print("PASS: touch focuses all account fields and chat; typed input reaches fields")
    quit(0)
