extends Node

# Original synthesized tones: no third-party recordings or microphone access.
const RATE := 22050
const NOTES := {
    "touch": [660.0, 880.0], "wave": [523.25, 659.25, 783.99],
    "feed": [392.0, 523.25, 659.25], "stretch": [330.0, 440.0, 550.0],
    "bubbles": [440.0, 700.0, 980.0], "drag": [350.0, 280.0],
    "sleep_start": [523.25, 392.0, 261.63], "sleep_end": [392.0, 523.25, 783.99]
}
var enabled := true
var player: AudioStreamPlayer
var cached: Dictionary = {}
var last_played := -1000

func _ready() -> void:
    var config := ConfigFile.new()
    if config.load("user://audio.cfg") == OK:
        enabled = bool(config.get_value("sound", "enabled", true))
    player = AudioStreamPlayer.new()
    player.volume_db = -15.0
    player.max_polyphony = 2
    add_child(player)

func set_enabled(value: bool) -> void:
    enabled = value
    if not enabled and is_instance_valid(player):
        player.stop()
    var config := ConfigFile.new()
    config.set_value("sound", "enabled", enabled)
    config.save("user://audio.cfg")

func sound_for(action: String) -> AudioStreamWAV:
    if not NOTES.has(action):
        return null
    if cached.has(action):
        return cached[action]
    var notes: Array = NOTES[action]
    var note_length := int(RATE * 0.10)
    var data := PackedByteArray()
    data.resize(note_length * notes.size() * 2)
    for note in range(notes.size()):
        for frame in range(note_length):
            var phase := float(frame) / RATE
            var envelope := minf(1.0, frame / 110.0) * pow(1.0 - float(frame) / note_length, 2.0)
            var sample := int(sin(TAU * float(notes[note]) * phase) * envelope * 16000.0)
            data.encode_s16((note * note_length + frame) * 2, sample)
    var sound := AudioStreamWAV.new()
    sound.format = AudioStreamWAV.FORMAT_16_BITS
    sound.mix_rate = RATE
    sound.stereo = false
    sound.data = data
    cached[action] = sound
    return sound

func play_action(action: String) -> void:
    if not enabled or not is_instance_valid(player) or Time.get_ticks_msec() - last_played < 120:
        return
    var sound := sound_for(action)
    if sound == null:
        return
    last_played = Time.get_ticks_msec()
    player.stream = sound
    player.play()
