extends Control

func _ready() -> void:
    mouse_filter = Control.MOUSE_FILTER_IGNORE
    resized.connect(queue_redraw)

func _draw() -> void:
    var mint := Color("e8f2e4")
    draw_style_box(_box(mint), Rect2(Vector2.ZERO, size))
    draw_circle(Vector2(size.x * 0.82, size.y * 0.2), 55, Color(1, 1, 1, 0.22))
    draw_circle(Vector2(size.x * 0.15, size.y * 0.5), 25, Color(1, 1, 1, 0.18))
    var points := PackedVector2Array()
    for index in range(49):
        var angle := float(index) / 48.0 * TAU
        points.append(Vector2(size.x * 0.5 + cos(angle) * 110, size.y - 43 + sin(angle) * 12))
    draw_polyline(points, Color("bfd4b8"), 1.5, true)

func _box(color: Color) -> StyleBoxFlat:
    var box := StyleBoxFlat.new()
    box.bg_color = color
    box.border_color = Color("d4e3cf")
    box.set_border_width_all(1)
    box.set_corner_radius_all(24)
    return box
