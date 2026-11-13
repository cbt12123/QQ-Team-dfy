extends RefCounted

var action: String = "idle"
var sleeping: bool = false
var offset := Vector2.ZERO
var drag_start := Vector2.ZERO
var offset_start := Vector2.ZERO
var held := false
var moved := false

func play(key: String) -> bool:
    if sleeping or held:
        return false
    action = key
    return true

func sleep() -> void:
    if held:
        return
    sleeping = true
    action = "sleep_start"

func wake() -> void:
    sleeping = false
    action = "sleep_end"

func ended() -> void:
    action = "sleep_loop" if sleeping else "idle"

func begin_drag(point: Vector2) -> void:
    if sleeping:
        return
    held = true
    moved = false
    drag_start = point
    offset_start = offset

func drag_to(point: Vector2, bounds: Rect2) -> void:
    if not held:
        return
    var delta := point - drag_start
    if delta.length() > 12.0:
        moved = true
    if moved:
        action = "drag"
        var target := offset_start + delta
        offset = Vector2(clampf(target.x, bounds.position.x, bounds.end.x), clampf(target.y, bounds.position.y, bounds.end.y))

func end_drag() -> bool:
    var was_moved := moved
    held = false
    moved = false
    if was_moved:
        action = "idle"
    return was_moved
