extends Control

const StateSource = preload("res://pet_state.gd")
const ApiSource = preload("res://api_client.gd")
const StageSource = preload("res://room_stage.gd")
const AudioSource = preload("res://pet_audio.gd")
const UpdateSource = preload("res://app_updater.gd")

var state = StateSource.new()
var api = ApiSource.new()
var actions: Dictionary = {}
var frame_cache: Dictionary = {}
var player: AnimatedSprite2D
var stage: Control
var status_label: Label
var bubble_label: Label
var sleep_button: Button
var pages: Dictionary = {}
var current_page := "room"
var current_action := ""
var finger := -99
var user: Dictionary = {}
var capabilities: Dictionary = {}
var chat_log: RichTextLabel # Hidden compatibility transcript; visible messages use bubbles.
var chat_scroll: ScrollContainer
var chat_rows: VBoxContainer
var emoji_palette: HBoxContainer
var login_form: VBoxContainer
var account_panel: VBoxContainer
var auth_buttons: Array[Button] = []
var personality_choice: OptionButton
var personality_custom: TextEdit
var personality_label: Label
var personality_busy := false
var history_loading := false
var chat_revision := 0
var audio = AudioSource.new()
var last_tap_ms := -1000
var chat_input: TextEdit
var send_button: Button
var network_label: Label
var account_label: Label
var username_input: LineEdit
var password_input: LineEdit
var updater = UpdateSource.new()
var update_label: Label
var update_check_button: Button
var update_download_button: Button
var update_install_button: Button
var update_cancel_button: Button
var auth_label: Label
var busy := false
var content_margin: MarginContainer
var keyboard_inset := 0

func _ready() -> void:
    add_child(api)
    add_child(updater)
    add_child(audio)
    var manifest: Array = JSON.parse_string(FileAccess.get_file_as_string("res://assets/actions.json"))
    for action in manifest:
        actions[str(action.key)] = action
    theme = Theme.new()
    theme.default_font = load("res://assets/fonts/NotoSansCJKsc-Regular.otf")
    theme.default_font_size = 18
    _build_ui()
    _sync_action()
    get_viewport().size_changed.connect(_place_pet)
    if "--capture" in OS.get_cmdline_user_args():
        await get_tree().create_timer(2.0).timeout
        get_viewport().get_texture().get_image().save_png("res://../artifacts/dafeyu-native-desktop.png")
        get_tree().quit()

func _box(color: String, radius: int = 16) -> StyleBoxFlat:
    var box := StyleBoxFlat.new()
    box.bg_color = Color(color)
    box.border_color = Color("d5e2d1")
    box.set_border_width_all(1)
    box.set_corner_radius_all(radius)
    box.content_margin_left = 14
    box.content_margin_right = 14
    box.content_margin_top = 10
    box.content_margin_bottom = 10
    return box

func _label(parent: Node, text: String, font_size: int = 18, color: String = "355345") -> Label:
    var label := Label.new()
    label.text = text
    label.add_theme_font_size_override("font_size", font_size)
    label.add_theme_color_override("font_color", Color(color))
    label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    parent.add_child(label)
    return label

func _button(text: String, callback: Callable, primary: bool = false) -> Button:
    var button := Button.new()
    button.text = text
    button.custom_minimum_size = Vector2(0, 54)
    button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    button.add_theme_stylebox_override("normal", _box("2f624b" if primary else "f6f9f1"))
    button.add_theme_stylebox_override("hover", _box("3d785d" if primary else "ffffff"))
    button.add_theme_stylebox_override("pressed", _box("254d3b" if primary else "d5e9cf"))
    button.add_theme_color_override("font_color", Color.WHITE if primary else Color("456249"))
    button.add_theme_color_override("font_hover_color", Color.WHITE if primary else Color("456249"))
    button.pressed.connect(callback)
    return button

func _field(parent: Node, placeholder: String, secret: bool = false) -> LineEdit:
    var input := LineEdit.new()
    input.placeholder_text = placeholder
    input.secret = secret
    input.custom_minimum_size.y = 52
    input.add_theme_stylebox_override("normal", _box("ffffff", 12))
    input.add_theme_stylebox_override("focus", _box("ffffff", 12))
    input.add_theme_color_override("font_color", Color("355345"))
    input.add_theme_color_override("font_placeholder_color", Color("758575"))
    parent.add_child(input)
    return input

func _build_ui() -> void:
    var margin := MarginContainer.new()
    content_margin = margin
    margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    for side in ["left", "right", "top", "bottom"]:
        margin.add_theme_constant_override("margin_" + side, 22 if side != "top" else 36)
    add_child(margin)
    var column := VBoxContainer.new()
    column.add_theme_constant_override("separation", 15)
    margin.add_child(column)
    var header := HBoxContainer.new()
    column.add_child(header)
    _label(header, "大肥鱼的小房间", 27)
    account_label = _label(header, "就在这里", 14, "809078")
    account_label.size_flags_horizontal = Control.SIZE_SHRINK_END
    account_label.custom_minimum_size.x = 90
    account_label.autowrap_mode = TextServer.AUTOWRAP_OFF
    account_label.clip_text = true
    account_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    var page_holder := Control.new()
    page_holder.size_flags_vertical = Control.SIZE_EXPAND_FILL
    column.add_child(page_holder)
    for key in ["room", "chat", "settings", "personality", "credits"]:
        var page := VBoxContainer.new()
        page.add_theme_constant_override("separation", 12)
        page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
        page_holder.add_child(page)
        pages[key] = page
    _build_room(pages.room)
    _build_chat(pages.chat)
    _build_settings(pages.settings)
    _build_personality(pages.personality)
    _build_credits(pages.credits)
    var navigation := HBoxContainer.new()
    navigation.add_theme_constant_override("separation", 10)
    column.add_child(navigation)
    navigation.add_child(_button("小房间", func(): _show_page("room")))
    navigation.add_child(_button("聊聊天", func(): _show_page("chat")))
    navigation.add_child(_button("设置", func(): _show_page("settings")))
    _show_page("room")

func _build_room(room: VBoxContainer) -> void:
    _label(room, "今天，也陪你待一会儿。", 29)
    _label(room, "摸摸她，拖着走，或者一起发一会儿呆。", 16, "819179")
    status_label = _label(room, "准备见面", 14, "698063")
    stage = Control.new()
    stage.custom_minimum_size.y = 340
    stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
    stage.clip_contents = true
    room.add_child(stage)
    var background = StageSource.new()
    background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    stage.add_child(background)
    player = AnimatedSprite2D.new()
    player.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
    stage.add_child(player)
    player.animation_finished.connect(func(): state.ended(); _sync_action())
    stage.resized.connect(_place_pet)
    var bubble := PanelContainer.new()
    bubble.add_theme_stylebox_override("panel", _box("ffffff", 14))
    room.add_child(bubble)
    bubble_label = _label(bubble, "你来啦。今天想一起做什么？", 17)
    var grid := GridContainer.new()
    grid.columns = 3
    grid.add_theme_constant_override("h_separation", 9)
    grid.add_theme_constant_override("v_separation", 9)
    room.add_child(grid)
    for entry in [["摸摸", "touch", "嘿嘿，有点痒。"], ["开饭啦", "feed", "有饭吃，今天也是幸福的大肥鱼！"], ["打招呼", "wave", "嗨，我在这里呀。"], ["伸懒腰", "stretch", "一起伸个大大的懒腰。"], ["吐泡泡", "bubbles", "咕噜咕噜，把烦恼吹走。"]]:
        var key: String = entry[1]
        var line: String = entry[2]
        grid.add_child(_button(entry[0], func(): _play(key, line)))
    sleep_button = _button("睡一会儿", _toggle_sleep)
    grid.add_child(sleep_button)
    grid.add_child(_button("陪我聊聊", func():
        _show_page("chat")
        chat_input.grab_focus()
        if user.is_empty(): network_label.text = "请先到设置登录，再开始聊天。"))
    grid.add_child(_button("随机惊喜", func():
        var choices := ["wave", "stretch", "bubbles", "feed"]
        _play(choices.pick_random(), "送你一个小惊喜！")))
    grid.add_child(_button("回到身边", func():
        _cancel_drag()
        state.offset = Vector2.ZERO
        if not state.sleeping: state.play("idle")
        bubble_label.text = "回到你身边啦。"
        _sync_action()))
    var credit := Button.new()
    credit.flat = true
    credit.text = "非商业同人体验版 · 角色与素材许可"
    credit.add_theme_font_size_override("font_size", 12)
    credit.add_theme_color_override("font_color", Color("83937b"))
    credit.pressed.connect(func(): _show_page("credits"))
    room.add_child(credit)

func _build_chat(page: VBoxContainer) -> void:
    _label(page, "只属于你的聊天", 27)
    network_label = _label(page, "请在设置中注册或登录后聊天。", 15, "8c7b53")
    chat_log = RichTextLabel.new()
    chat_log.visible = false
    page.add_child(chat_log)
    chat_scroll = ScrollContainer.new()
    chat_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
    chat_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    page.add_child(chat_scroll)
    chat_rows = VBoxContainer.new()
    chat_rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    chat_rows.add_theme_constant_override("separation", 12)
    chat_scroll.add_child(chat_rows)
    var composer := HBoxContainer.new()
    page.add_child(composer)
    chat_input = TextEdit.new()
    chat_input.custom_minimum_size = Vector2(0, 84)
    chat_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    chat_input.placeholder_text = "今天发生了什么？"
    chat_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
    chat_input.add_theme_color_override("font_color", Color("355345"))
    chat_input.add_theme_stylebox_override("normal", _box("ffffff"))
    composer.add_child(chat_input)
    var emoji_button := _button("☺", func(): emoji_palette.visible = not emoji_palette.visible)
    emoji_button.size_flags_horizontal = Control.SIZE_SHRINK_END
    composer.add_child(emoji_button)
    send_button = _button("发送", _send_message, true)
    send_button.size_flags_horizontal = Control.SIZE_SHRINK_END
    composer.add_child(send_button)
    emoji_palette = HBoxContainer.new()
    emoji_palette.visible = false
    page.add_child(emoji_palette)
    for glyph in ["😊", "❤️", "🐟", "✨", "🌙", "👋"]:
        var emoji: String = glyph
        emoji_palette.add_child(_button(emoji, func(): chat_input.insert_text_at_caret(emoji)))

func _append_bubble(role: String, text: String) -> Label:
    var row := HBoxContainer.new()
    chat_rows.add_child(row)
    var spacer := Control.new()
    spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    var panel := PanelContainer.new()
    panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    panel.size_flags_stretch_ratio = 4.0
    panel.add_theme_stylebox_override("panel", _box("cce7b5" if role == "user" else "ffffff", 12))
    if role == "user": row.add_child(spacer)
    row.add_child(panel)
    if role != "user": row.add_child(spacer)
    var label := _label(panel, text, 17)
    label.tooltip_text = "你" if role == "user" else "大肥鱼"
    chat_log.text += text + "\n"
    _scroll_chat.call_deferred()
    return label

func _scroll_chat() -> void:
    await get_tree().process_frame
    chat_scroll.scroll_vertical = int(chat_scroll.get_v_scroll_bar().max_value)

func _clear_chat() -> void:
    for child in chat_rows.get_children():
        chat_rows.remove_child(child)
        child.queue_free()
    chat_log.text = ""

func _build_settings(page: VBoxContainer) -> void:
    _label(page, "连接你的大肥鱼", 27)
    var scroll := ScrollContainer.new()
    scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
    scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
    page.add_child(scroll)
    var form := VBoxContainer.new()
    form.add_theme_constant_override("separation", 12)
    form.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    scroll.add_child(form)
    _label(form, "每个人的聊天、记忆和性格设置独立保存。", 15, "819179")
    login_form = VBoxContainer.new()
    login_form.add_theme_constant_override("separation", 12)
    form.add_child(login_form)
    username_input = _field(login_form, "用户名（英文、数字或下划线）")
    username_input.max_length = 32
    password_input = _field(login_form, "密码（至少12位）", true)
    password_input.max_length = 128
    var row := HBoxContainer.new()
    login_form.add_child(row)
    for registering in [false, true]:
        var register: bool = registering
        var button := _button("注册" if register else "登录", func(): _authenticate(register), not register)
        auth_buttons.append(button)
        row.add_child(button)
    account_panel = VBoxContainer.new()
    account_panel.visible = false
    form.add_child(account_panel)
    account_panel.add_child(_button("设置大肥鱼的性格", func(): _show_page("personality"); _load_personality()))
    account_panel.add_child(_button("退出登录", _logout))
    auth_label = _label(form, "无需登录即可玩动作；登录会话仅在内存保存。", 13, "819179")
    var sound_toggle := CheckButton.new()
    for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
        sound_toggle.add_theme_color_override(color_name, Color("355345"))
    sound_toggle.text = "动作音效"
    sound_toggle.button_pressed = audio.enabled
    sound_toggle.toggled.connect(func(value: bool): audio.set_enabled(value))
    form.add_child(sound_toggle)
    form.add_child(_button("角色、引擎与字体许可", func(): _show_page("credits")))
    _label(form, "应用更新 · 当前 " + str(updater.version.version_name), 20)
    update_label = _label(form, "下载后由 Android 确认安装，会保留已有应用数据。", 14)
    update_check_button = _button("检查更新", updater.check_update)
    form.add_child(update_check_button)
    update_download_button = _button("下载新版", updater.download_update)
    form.add_child(update_download_button)
    update_install_button = _button("安装更新", updater.install_update)
    form.add_child(update_install_button)
    update_cancel_button = _button("取消下载", updater.cancel)
    form.add_child(update_cancel_button)
    updater.changed.connect(func(message: String):
        update_label.text = message
        _update_buttons())
    updater.progress.connect(func(downloaded: int, total: int):
        update_label.text = "正在下载：%.1f / %.1f MB" % [downloaded / 1048576.0, total / 1048576.0])
    _update_buttons()

func _build_personality(page: VBoxContainer) -> void:
    _label(page, "大肥鱼的性格", 27)
    _label(page, "只对当前账号生效。填写自定义性格后，将优先使用它作为角色规则；留空时使用所选预设。", 15)
    personality_choice = OptionButton.new()
    for title in ["亲切友好", "活泼俏皮", "平静温柔"]:
        personality_choice.add_item(title)
    page.add_child(personality_choice)
    personality_custom = TextEdit.new()
    personality_custom.placeholder_text = "角色、说话方式和互动规则（最多1000字）"
    personality_custom.custom_minimum_size.y = 180
    personality_custom.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
    page.add_child(personality_custom)
    personality_custom.text_changed.connect(func():
        personality_label.text = "%d / 1000字" % personality_custom.text.length())
    personality_label = _label(page, "", 14)
    page.add_child(_button("保存性格", _save_personality, true))
    page.add_child(_button("返回设置", func(): _show_page("settings")))

func _load_personality() -> void:
    if user.is_empty() or personality_busy: return
    personality_busy = true
    var version: int = api.generation
    personality_label.text = "正在读取…"
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_GET, "/api/personality")
    personality_busy = false
    if version != api.generation: return
    if not result.ok:
        personality_label.text = str(result.error)
        return
    var value: Dictionary = result.data.get("personality", result.data)
    personality_choice.select(maxi(0, ["friendly", "playful", "calm"].find(value.get("preset", "friendly"))))
    personality_custom.text = str(value.get("custom", ""))
    personality_label.text = "已读取当前账号的性格。"

func _save_personality() -> void:
    if user.is_empty() or personality_busy: return
    if personality_custom.text.length() > 1000:
        personality_label.text = "自定义性格最多1000字，请缩短后保存。"
        return
    personality_busy = true
    var version: int = api.generation
    personality_label.text = "正在保存…"
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_PUT, "/api/personality", {"preset": ["friendly", "playful", "calm"][personality_choice.selected], "custom": personality_custom.text})
    personality_busy = false
    if version != api.generation: return
    personality_label.text = "性格已保存。" if result.ok else str(result.error)

func _update_buttons() -> void:
    update_check_button.disabled = is_instance_valid(updater.request)
    update_download_button.visible = not updater.artifact.is_empty() and updater.verified_path.is_empty() and not updater.downloading
    update_install_button.visible = not updater.verified_path.is_empty()
    update_cancel_button.visible = updater.downloading

func _build_credits(page: VBoxContainer) -> void:
    _label(page, "让大肥鱼来到这里的人", 25)
    var text := RichTextLabel.new()
    text.size_flags_vertical = Control.SIZE_EXPAND_FILL
    text.selection_enabled = true
    text.bbcode_enabled = false
    text.add_theme_color_override("default_color", Color("4b6550"))
    text.text = "非商业同人项目，非 DeepSeek 官方产品，也不代表作者背书。\n\n动画：PC2005-cloud / dsh-pet\nhttps://github.com/PC2005-cloud/dsh-pet\n\n角色原型“溟月”：上善无形\nDeepSeek版女仆鲸鱼娘设计：ZipZipPipe\n\n形象与相关素材：CC BY-NC-SA 4.0\n署名、非商业、相同方式共享。\nhttps://creativecommons.org/licenses/by-nc-sa/4.0/\n\n本客户端从固定版本的10段透明 WebM 提取12fps帧，按alpha阈值联合裁切、缩放并合成二维图集；未添加或擦除来源标识。衍生素材保持相同许可。\n\nGodot Engine：MIT\n中文字体：Noto Sans CJK，SIL Open Font License 1.1。\n\n完整原始许可与出处随 APK 打包在 res://licenses/ 和 res://assets/fonts/。\n\n聊天与个人记忆使用独立云端后端；本 APK 不含模型密钥，不需要QQ或本地WSL。"
    page.add_child(text)
    page.add_child(_button("回到小房间", func(): _show_page("room")))

func _show_page(key: String) -> void:
    if key != "room" and state.held:
        _cancel_drag()
    current_page = key
    for name in pages:
        pages[name].visible = name == key
    if player != null and not current_action.is_empty():
        if key == "room":
            player.play()
        else:
            player.pause()

func _process(_delta: float) -> void:
    if content_margin == null or not DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD):
        return
    var screen_scale: float = maxf(0.01, get_viewport().get_screen_transform().get_scale().y)
    _apply_keyboard_inset(int(ceilf(DisplayServer.virtual_keyboard_get_height() / screen_scale)))

func _apply_keyboard_inset(height: int) -> void:
    if height == keyboard_inset:
        return
    keyboard_inset = maxi(0, height)
    content_margin.add_theme_constant_override("margin_bottom", 22 + keyboard_inset)

func _frames_for(key: String) -> SpriteFrames:
    if frame_cache.has(key):
        return frame_cache[key]
    # Keep idle + one active action; never preload all uncompressed atlases.
    if frame_cache.size() >= 2:
        for old in frame_cache.keys():
            if old != "idle":
                frame_cache.erase(old)
    var metadata: Dictionary = actions[key]
    var frames := SpriteFrames.new()
    frames.remove_animation("default")
    frames.add_animation(key)
    frames.set_animation_speed(key, float(metadata.fps))
    frames.set_animation_loop(key, bool(metadata.loop) or key == "drag")
    var textures: Array[Texture2D] = []
    for path in metadata.pages:
        textures.append(load(path))
    for entry in metadata.frames:
        var atlas := AtlasTexture.new()
        atlas.atlas = textures[int(entry.page)]
        var rect: Array = entry.rect
        atlas.region = Rect2(float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]))
        frames.add_frame(key, atlas)
    frame_cache[key] = frames
    return frames

func _sync_action() -> void:
    if player == null or not actions.has(state.action):
        return
    if state.action != current_action:
        current_action = state.action
        player.sprite_frames = _frames_for(current_action)
        player.play(current_action)
        audio.play_action(current_action)
        if OS.is_debug_build():
            print("PET_ACTION:", current_action, " CACHE:", frame_cache.size())
    sleep_button.text = "叫她起床" if state.sleeping else "睡一会儿"
    status_label.text = "睡觉中，点一下就会醒来" if state.sleeping else "你正在拖着她走" if state.held and state.moved else str(actions[state.action].label)
    _place_pet()

func _place_pet() -> void:
    if player == null or stage == null or not actions.has(state.action):
        return
    # Container layout starts at zero size; do not persist a clamp from that pass.
    if stage.size.x < 300.0 or stage.size.y < 310.0:
        return
    var metadata: Dictionary = actions[state.action]
    var bounds: Array = metadata.source_bounds
    var cell: float = float(metadata.frames[0].rect[2])
    var width: float = float(bounds[2] - bounds[0])
    var height: float = float(bounds[3] - bounds[1])
    var ratio: float = (cell - 12.0) / maxf(width, height)
    var padding := Vector2((cell - roundf(width * ratio)) / 2.0, (cell - roundf(height * ratio)) / 2.0)
    var pivot := Vector2((320.0 - bounds[0]) * ratio, (330.0 - bounds[1]) * ratio) + padding - Vector2.ONE * cell / 2.0
    player.offset = -pivot
    var world_scale: float = minf(1.1, maxf(0.6, (stage.size.y - 50.0) / 300.0))
    player.scale = Vector2.ONE * world_scale / ratio
    var drag_bounds := _drag_bounds(state.action)
    state.offset = state.offset.clamp(drag_bounds.position, drag_bounds.end)
    player.position = Vector2(stage.size.x / 2.0, stage.size.y - 44.0) + state.offset

func _drag_bounds(key: String) -> Rect2:
    var bounds: Array = actions[key].source_bounds
    var world_scale: float = minf(1.1, maxf(0.6, (stage.size.y - 50.0) / 300.0))
    var foot := Vector2(stage.size.x / 2.0, stage.size.y - 44.0)
    var minimum := Vector2.ONE * 8.0 - foot - Vector2(bounds[0] - 320, bounds[1] - 330) * world_scale
    var maximum := stage.size - Vector2.ONE * 8.0 - foot - Vector2(bounds[2] - 320, bounds[3] - 330) * world_scale
    return Rect2(minimum.min(maximum), (maximum - minimum).max(Vector2.ZERO))

func _cancel_drag() -> void:
    state.end_drag()
    finger = -99
    _sync_action()

func _play(key: String, line: String) -> void:
    if state.play(key):
        bubble_label.text = line
        _sync_action()
    else:
        bubble_label.text = "我在睡觉，轻轻点一下叫我起床吧。" if state.sleeping else "先放我下来嘛。"

func _toggle_sleep() -> void:
    if state.sleeping:
        state.wake()
        bubble_label.text = "睡饱啦，你还在呀。"
    else:
        state.sleep()
        bubble_label.text = "那我先睡一小会儿，晚安。"
    _sync_action()

func _input(event: InputEvent) -> void:
    if current_page != "room" or stage == null:
        return
    # The room handles raw touch; synthetic mouse events are for native form controls.
    if (event is InputEventMouseButton or event is InputEventMouseMotion) and event.device == InputEvent.DEVICE_ID_EMULATION:
        return
    var point := Vector2.ZERO
    var pressed := false
    var released := false
    var dragging := false
    var pointer := -1
    if event is InputEventScreenTouch:
        if event.canceled and event.index == finger:
            _cancel_drag()
            get_viewport().set_input_as_handled()
            return
        point = event.position
        pointer = event.index
        pressed = event.pressed
        released = not event.pressed
    elif event is InputEventScreenDrag:
        point = event.position
        pointer = event.index
        dragging = true
    elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
        point = event.position
        pressed = event.pressed
        released = not event.pressed
    elif event is InputEventMouseMotion and finger == -1:
        point = event.position
        dragging = true
    else:
        return
    var local := point - stage.global_position
    if pressed and finger == -99:
        var pet_rect := Rect2(player.position - Vector2(125, 300), Vector2(250, 320))
        if not stage.get_global_rect().has_point(point) or not pet_rect.has_point(local):
            return
        if state.sleeping:
            _toggle_sleep()
            get_viewport().set_input_as_handled()
            return
        finger = pointer
        state.begin_drag(local)
    elif dragging and pointer == finger:
        state.drag_to(local, _drag_bounds("drag"))
        _sync_action()
    elif released and pointer == finger:
        finger = -99
        var moved: bool = state.end_drag()
        if moved:
            bubble_label.text = "到这里啦，还是你身边舒服。"
            _sync_action()
        else:
            var now := Time.get_ticks_msec()
            if now - last_tap_ms < 350:
                _play("bubbles", "咕噜咕噜，接住你的小开心。")
                last_tap_ms = -1000
            else:
                _play("touch", "嘿嘿，有点痒。")
                last_tap_ms = now
    else:
        return
    get_viewport().set_input_as_handled()

func _clear_account() -> void:
    user = {}
    capabilities = {}
    password_input.text = ""
    chat_input.text = ""
    chat_revision += 1
    _clear_chat()
    login_form.visible = true
    account_panel.visible = false
    personality_custom.text = ""
    personality_choice.select(0)
    personality_label.text = ""
    account_label.text = "就在这里"
    network_label.text = "请先在设置中注册或登录。"

func _logout() -> void:
    api.logout_remotely()
    _clear_account()
    auth_label.text = "已退出，当前页面与会话已清除。"

func _authenticate(registering: bool) -> void:
    if busy:
        return
    if username_input.text.length() < 3 or password_input.text.length() < 12:
        auth_label.text = "用户名至少3位，密码至少12位。"
        return
    busy = true
    for button in auth_buttons: button.disabled = true
    var body := {"username": username_input.text, "password": password_input.text}
    api.invalidate()
    _clear_account()
    var version: int = api.generation
    auth_label.text = "正在连接…"
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_POST, "/api/register" if registering else "/api/login", body)
    busy = false
    for button in auth_buttons: button.disabled = false
    if version != api.generation:
        return
    password_input.text = ""
    if not result.ok:
        auth_label.text = str(result.error)
        return
    if not result.data.get("user") is Dictionary:
        auth_label.text = "登录响应格式不正确，请检查服务器地址。"
        return
    user = result.data.user
    login_form.visible = false
    account_panel.visible = true
    account_label.text = str(user.get("displayName", user.get("username", "朋友")))
    var me: Dictionary = await api.request_json(HTTPClient.METHOD_GET, "/api/me")
    if version != api.generation:
        return
    if me.get("status", 0) == 401:
        api.invalidate()
        _clear_account()
        auth_label.text = "登录已失效，请重新登录。"
        return
    if me.ok and me.data.get("capabilities") is Dictionary:
        capabilities = me.data.capabilities
    auth_label.text = ("注册成功，已自动登录。" if registering else "登录成功。") + "会话仅在当前 App 进程中保存。"
    network_label.text = "你的记录和记忆只属于这个账号。" if capabilities.get("chat", false) else "此服务器尚未配置聊天模型。"
    await _load_history(version)
    if version == api.generation:
        network_label.text = auth_label.text + " " + network_label.text
        _show_page("chat")

func _expire_session() -> void:
    api.invalidate()
    _clear_account()
    auth_label.text = "登录已失效，请重新登录。"
    network_label.text = auth_label.text
    _show_page("settings")

func _load_history(version: int) -> void:
    history_loading = true
    var revision := chat_revision
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_GET, "/api/messages")
    history_loading = false
    if version != api.generation or revision != chat_revision:
        return
    if not result.ok:
        if result.get("status", 0) == 401:
            _expire_session()
            return
        network_label.text = str(result.error)
        return
    if not result.data.get("messages") is Array:
        network_label.text = "聊天记录格式不正确。"
        return
    _clear_chat()
    var messages: Array = result.data.messages
    for message in messages.slice(maxi(0, messages.size() - 60)):
        if message is Dictionary and message.get("text") is String:
            _append_bubble(str(message.get("role", "assistant")), str(message.text))

func _send_message() -> void:
    if busy or history_loading:
        return
    if user.is_empty():
        network_label.text = "请先到设置注册或登录后聊天。"
        return
    var text := chat_input.text.strip_edges()
    if text.is_empty() or text.length() > 4000:
        network_label.text = "消息需1～4000字。"
        return
    busy = true
    chat_revision += 1
    send_button.disabled = true
    var version: int = api.generation
    var draft := _append_bubble("user", text)
    chat_input.text = ""
    emoji_palette.visible = false
    var reply := _append_bubble("assistant", "正在想你的话…")
    var received := [false]
    network_label.text = "大肥鱼正在想你的话…"
    var request_id := Crypto.new().generate_random_bytes(16).hex_encode()
    var result: Dictionary = await api.stream_message({"requestId": request_id, "text": text}, func(delta: String):
        if version != api.generation or not is_instance_valid(reply): return
        if not received[0]:
            reply.text = ""
            received[0] = true
        reply.text += delta
        chat_log.text += delta
        _scroll_chat.call_deferred())
    busy = false
    send_button.disabled = false
    if version != api.generation:
        return
    if not result.ok:
        if result.get("status", 0) == 401:
            _expire_session()
            return
        draft.tooltip_text = "发送结果未确认，请查看记录后再决定是否重发。"
        reply.text = (reply.text + "\n" if received[0] else "") + "回复中断：" + str(result.error)
        network_label.text = "发送结果未确认；请重新登录查看记录，避免重复发送。"
        return
    if not received[0]: reply.text = "回复未返回文字，请稍后查看记录。"
    network_label.text = "你说的，我认真听着。"

func _notification(what: int) -> void:
    if player == null:
        return
    if what == NOTIFICATION_APPLICATION_PAUSED:
        _cancel_drag()
        player.pause()
    elif what == NOTIFICATION_APPLICATION_RESUMED and current_page == "room":
        _sync_action()
        player.play()
