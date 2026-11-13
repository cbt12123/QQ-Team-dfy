extends Control

const StateSource = preload("res://pet_state.gd")
const ApiSource = preload("res://api_client.gd")
const StageSource = preload("res://room_stage.gd")

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
var chat_log: RichTextLabel
var chat_input: TextEdit
var send_button: Button
var network_label: Label
var account_label: Label
var server_input: LineEdit
var username_input: LineEdit
var password_input: LineEdit
var invite_input: LineEdit
var auth_label: Label
var busy := false

func _ready() -> void:
    add_child(api)
    var manifest: Array = JSON.parse_string(FileAccess.get_file_as_string("res://assets/actions.json"))
    for action in manifest:
        actions[str(action.key)] = action
    theme = Theme.new()
    theme.default_font = load("res://assets/fonts/NotoSansCJKsc-Regular.otf")
    theme.default_font_size = 18
    _build_ui()
    var config := ConfigFile.new()
    if config.load("user://settings.cfg") == OK:
        api.set_base(str(config.get_value("connection", "server", api.base_url)))
    server_input.text = api.base_url
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
    parent.add_child(input)
    return input

func _build_ui() -> void:
    var margin := MarginContainer.new()
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
    for key in ["room", "chat", "settings", "credits"]:
        var page := VBoxContainer.new()
        page.add_theme_constant_override("separation", 12)
        page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
        page_holder.add_child(page)
        pages[key] = page
    _build_room(pages.room)
    _build_chat(pages.chat)
    _build_settings(pages.settings)
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
    var credit := Button.new()
    credit.flat = true
    credit.text = "非商业同人体验版 · 角色与素材许可"
    credit.add_theme_font_size_override("font_size", 12)
    credit.add_theme_color_override("font_color", Color("83937b"))
    credit.pressed.connect(func(): _show_page("credits"))
    room.add_child(credit)

func _build_chat(page: VBoxContainer) -> void:
    _label(page, "只属于你的聊天", 27)
    network_label = _label(page, "云端正式聊天尚未上线。先在设置里填写服务器并登录；现在可以离线玩动作。", 15, "8c7b53")
    chat_log = RichTextLabel.new()
    chat_log.bbcode_enabled = false
    chat_log.scroll_following = true
    chat_log.selection_enabled = true
    chat_log.size_flags_vertical = Control.SIZE_EXPAND_FILL
    chat_log.add_theme_color_override("default_color", Color("355345"))
    chat_log.add_theme_stylebox_override("normal", _box("ffffff"))
    chat_log.text = "这里还没有故事。\n从一句你好开始，也很好。"
    page.add_child(chat_log)
    chat_input = TextEdit.new()
    chat_input.custom_minimum_size.y = 100
    chat_input.placeholder_text = "今天发生了什么？"
    chat_input.add_theme_color_override("font_color", Color("355345"))
    chat_input.add_theme_stylebox_override("normal", _box("ffffff"))
    chat_input.add_theme_stylebox_override("focus", _box("ffffff"))
    page.add_child(chat_input)
    send_button = _button("发送", _send_message, true)
    page.add_child(send_button)
    _label(page, "当前 APK 先验证动作和文字入口；原生录音、语音播放后续接入。", 12, "89947f")

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
    _label(form, "现有公网地址只提供动作预览，不能注册或聊天。正式服务启用后，在这里填写它的 HTTPS 地址。", 15, "819179")
    _label(form, "服务器地址", 15)
    server_input = _field(form, "https://你的服务器")
    form.add_child(_button("保存服务器地址", _save_server))
    _label(form, "只连接你信任的服务器。聊天会经云端发送到模型服务商。", 12, "89947f")
    username_input = _field(form, "用户名（英文、数字或下划线）")
    username_input.max_length = 32
    password_input = _field(form, "密码（至少12位）", true)
    password_input.max_length = 128
    invite_input = _field(form, "受邀注册时填写邀请口令")
    invite_input.max_length = 100
    var row := HBoxContainer.new()
    row.add_theme_constant_override("separation", 10)
    form.add_child(row)
    row.add_child(_button("登录", func(): _authenticate(false), true))
    row.add_child(_button("受邀注册", func(): _authenticate(true)))
    form.add_child(_button("退出并清除当前页面", _logout))
    auth_label = _label(form, "首版只在内存中保存登录会话，不把密码或会话写入磁盘；退出 App 后需重新登录。", 13, "819179")
    form.add_child(_button("角色、引擎与字体许可", func(): _show_page("credits")))

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
            _play("touch", "嘿嘿，有点痒。")
    else:
        return
    get_viewport().set_input_as_handled()

func _save_server() -> void:
    if not api.set_base(server_input.text):
        auth_label.text = "请填不带路径的 HTTPS 地址；HTTP 仅允许本机与模拟器调试地址。"
        return
    api.invalidate()
    _clear_account()
    var config := ConfigFile.new()
    config.set_value("connection", "server", api.base_url)
    var saved := config.save("user://settings.cfg")
    auth_label.text = "服务器地址已保存，请登录。" if saved == OK else "当前会话地址已设置，但无法保存到设备。"

func _clear_account() -> void:
    user = {}
    capabilities = {}
    password_input.text = ""
    invite_input.text = ""
    chat_input.text = ""
    chat_log.text = "这里还没有故事。"
    account_label.text = "就在这里"
    network_label.text = "请先在设置中登录。当前默认公网地址仅提供动作预览。"

func _logout() -> void:
    api.logout_remotely()
    _clear_account()
    auth_label.text = "已退出，当前页面与会话已清除。"

func _authenticate(registering: bool) -> void:
    if busy:
        return
    if not api.set_base(server_input.text):
        auth_label.text = "服务器地址不正确。"
        return
    if username_input.text.length() < 3 or password_input.text.length() < 12:
        auth_label.text = "用户名至少3位，密码至少12位。"
        return
    busy = true
    var body := {"username": username_input.text, "password": password_input.text}
    if registering:
        body.invite = invite_input.text.strip_edges()
    api.invalidate()
    _clear_account()
    var version: int = api.generation
    auth_label.text = "正在连接…"
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_POST, "/api/register" if registering else "/api/login", body)
    busy = false
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
    auth_label.text = "登录成功。会话仅在当前 App 进程中保存。"
    network_label.text = "你的记录和记忆只属于这个账号。" if capabilities.get("chat", false) else "此服务器尚未配置聊天模型。"
    await _load_history(version)
    if version == api.generation:
        _show_page("chat")

func _load_history(version: int) -> void:
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_GET, "/api/messages")
    if version != api.generation:
        return
    if not result.ok:
        if result.get("status", 0) == 401:
            api.invalidate()
            _clear_account()
        network_label.text = str(result.error)
        return
    var lines := PackedStringArray()
    if not result.data.get("messages") is Array:
        network_label.text = "聊天记录格式不正确。"
        return
    var messages: Array = result.data.messages
    for message in messages.slice(maxi(0, messages.size() - 60)):
        if message is Dictionary and message.get("text") is String:
            lines.append(("你" if message.get("role") == "user" else "大肥鱼") + "\n" + str(message.text) + "\n")
    chat_log.text = "\n".join(lines) if not lines.is_empty() else "这里还没有故事。从一句你好开始吧。"

func _send_message() -> void:
    if busy:
        return
    if user.is_empty():
        network_label.text = "请先到设置登录。现有公网动作预览尚未开放聊天。"
        return
    var text := chat_input.text.strip_edges()
    if text.is_empty() or text.length() > 4000:
        network_label.text = "消息需1～4000字。"
        return
    busy = true
    send_button.disabled = true
    var version: int = api.generation
    network_label.text = "大肥鱼正在想你的话…"
    var request_id := Crypto.new().generate_random_bytes(16).hex_encode()
    var result: Dictionary = await api.request_json(HTTPClient.METHOD_POST, "/api/messages", {"requestId": request_id, "text": text})
    busy = false
    send_button.disabled = false
    if version != api.generation:
        return
    if not result.ok:
        if result.get("status", 0) == 401:
            api.invalidate()
            _clear_account()
        network_label.text = str(result.error) + "；网络中断后请先重新登录查看记录，勿连续重发。"
        return
    chat_input.text = ""
    network_label.text = "你说的，我认真听着。"
    await _load_history(version)

func _notification(what: int) -> void:
    if player == null:
        return
    if what == NOTIFICATION_APPLICATION_PAUSED:
        _cancel_drag()
        player.pause()
    elif what == NOTIFICATION_APPLICATION_RESUMED and current_page == "room":
        _sync_action()
        player.play()
