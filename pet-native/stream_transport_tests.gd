extends SceneTree

func _init() -> void:
    call_deferred("_run")

func _run() -> void:
    var api = load("res://api_client.gd").new()
    root.add_child(api)
    if not api.has_method("stream_message"):
        push_error("Missing genuine SSE transport")
        quit(1)
        return
    api.set_base("http://127.0.0.1:18946")
    api.cookie = "pet_session=fixture"
    var pieces: Array = []
    var start := Time.get_ticks_msec()
    var result: Dictionary = await api.stream_message({}, func(value): pieces.append([value, Time.get_ticks_msec() - start]))
    assert(result.ok and result.data.reply == "你好", str(result))
    assert(pieces.size() == 2 and pieces[0][0] == "你" and pieces[1][0] == "好", str(pieces))
    assert(pieces[0][1] < 450, "Delta must arrive before delayed done")
    assert(Time.get_ticks_msec() - start >= 650)
    pieces.clear()
    var cancelled: Dictionary = await api.stream_message({}, func(value):
        pieces.append(value)
        api.invalidate())
    assert(cancelled.get("cancelled", false))
    assert(pieces == ["你"] and api.active == 0)
    assert(api.stream_clients.is_empty())
    api.cookie = "pet_session=fixture_error"
    var failure: Dictionary = await api.stream_message({}, func(_value): assert(false))
    assert(not failure.ok and failure.error == "fixture error")
    api.cookie = "pet_session=fixture_redirect"
    failure = await api.stream_message({}, func(_value): assert(false))
    assert(not failure.ok and failure.status == 302)
    api.cookie = "pet_session=fixture_large"
    failure = await api.stream_message({}, func(_value): assert(false))
    assert(not failure.ok and "过大" in failure.error)
    api.active = 3
    failure = await api.stream_message({}, func(_value): assert(false))
    assert(not failure.ok and failure.status == 0)
    api.active = 0
    print("PASS: genuine delayed SSE, split UTF-8/CRLF, immediate invalidation")
    quit(0)
