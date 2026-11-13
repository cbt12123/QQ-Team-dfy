extends SceneTree

func _init() -> void:
    var audio = load("res://pet_audio.gd").new()
    for action in ["touch", "wave", "feed", "stretch", "bubbles", "drag", "sleep_start", "sleep_end"]:
        var sample = audio.sound_for(action)
        assert(sample is AudioStreamWAV)
        assert(sample.mix_rate == 22050 and not sample.stereo)
        assert(sample.data.size() > 1000 and sample.data.size() < 50000)
        assert(sample.data.count(0) < sample.data.size(), "Sounds must contain actual PCM samples")
    assert(audio.sound_for("idle") == null)
    assert(audio.sound_for("sleep_loop") == null)
    audio.free()
    print("PASS: original short PCM action sounds, bounded size and no idle/sleep loops")
    quit(0)
