extends SceneTree

func _init() -> void:
    call_deferred("_run")

func _run() -> void:
    var options: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://../.cache/pet-native-api-fixture.json"))
    var room = load("res://main.tscn").instantiate()
    root.add_child(room)
    await process_frame
    room.server_input.text = str(options.base)
    room.username_input.text = "native-contract"
    room.password_input.text = "a native fixture password 123"
    await room._authenticate(true)
    assert(not room.user.is_empty(), "Native registration must use the actual HTTP contract")
    assert(not room.api.cookie.is_empty())
    room.chat_input.text = "hello-native"
    await room._send_message()
    assert("native-fixture:hello-native" in room.chat_log.text)
    room.chat_input.text = "late-private-old-account"
    room._send_message()
    await create_timer(0.03).timeout
    var generation: int = room.api.generation
    room._save_server()  # Saving even the SAME server must invalidate the old identity.
    assert(room.api.generation > generation)
    assert(room.user.is_empty())
    await create_timer(0.5).timeout
    assert(not "late-private" in room.chat_log.text)
    assert(room.api.cookie.is_empty())
    room.queue_free()
    print("PASS: native registration/login cookie, private text chat and stale-account response invalidation")
    quit(0)
