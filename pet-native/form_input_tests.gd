extends SceneTree

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
    room.server_input.text = room.api.PREVIEW_BASE
    await room._authenticate(true)
    assert("注册和登录尚未开放" in room.auth_label.text)
    assert(room.api.active == 0, "Preview registration must stop before a network request")
    room._show_page("chat")
    await process_frame
    await tap(room.chat_input)
    assert(room.chat_input.has_focus(), "Touch must focus chat entry")
    room.queue_free()
    await process_frame
    print("PASS: touch focuses all account fields and chat; typed input reaches fields")
    quit(0)
