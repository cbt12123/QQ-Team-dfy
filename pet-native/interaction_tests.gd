extends SceneTree

func _init() -> void:
    call_deferred("run")

func run() -> void:
    root.size = Vector2i(540, 1200)
    var room = load("res://main.tscn").instantiate()
    root.add_child(room)
    await process_frame
    await process_frame
    assert(room.state.offset == Vector2.ZERO, "Initial layout must leave pet centered")
    room.state.begin_drag(Vector2.ZERO)
    room.finger = 0
    room._show_page("chat")
    assert(not room.state.held, "Leaving room must release a held pet")
    assert(room.finger == -99)
    room._show_page("room")
    room.state.begin_drag(Vector2.ZERO)
    room.finger = 0
    var move := InputEventScreenDrag.new()
    move.index = 0
    move.position = room.stage.global_position + Vector2(2000, 2000)
    room._input(move)
    var bounds: Array = room.actions.drag.source_bounds
    var foot := Vector2(room.stage.size.x / 2.0, room.stage.size.y - 44.0)
    var scale: float = minf(1.1, maxf(0.6, (room.stage.size.y - 50.0) / 300.0))
    var bottom_right: Vector2 = foot + room.state.offset + Vector2(bounds[2] - 320, bounds[3] - 330) * scale
    assert(bottom_right.x <= room.stage.size.x and bottom_right.y <= room.stage.size.y, "Dragged alpha bounds must stay inside tall room")
    var cancel := InputEventScreenTouch.new()
    cancel.index = 0
    cancel.canceled = true
    room._input(cancel)
    assert(not room.state.held and room.finger == -99)
    assert(room.state.action == "idle", "Canceled touch must not trigger petting")
    var synthetic := InputEventMouseButton.new()
    synthetic.device = InputEvent.DEVICE_ID_EMULATION
    synthetic.button_index = MOUSE_BUTTON_LEFT
    synthetic.pressed = true
    synthetic.position = room.stage.global_position + room.player.position - Vector2(0, 100)
    room._input(synthetic)
    assert(not room.state.held, "Synthetic mouse must not duplicate a pet touch")
    room.queue_free()
    await process_frame
    print("PASS: native page switching, tall-screen bounds and canceled touches")
    quit(0)
