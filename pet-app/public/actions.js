export class PetActions {
  constructor(actions, { reducedMotion = false, onChange = () => {} } = {}) {
    this.actions = actions; this.reducedMotion = reducedMotion; this.onChange = onChange;
    this.idle = actions.find(a => /待机呼吸/.test(a.label)) || actions.find(a => a.id === 'idle') || actions[0];
    this.sleeping = false; this.currentMode = 'idle'; this.current = this.idle;
  }
  get state() { return { action: this.current, mode: this.currentMode, sleeping: this.sleeping, animate: !this.reducedMotion }; }
  emit() { this.onChange(this.state); }
  play(id) {
    if (this.sleeping || ['listening', 'speaking'].includes(this.currentMode)) return false;
    const action = this.actions.find(a => a.id === id); if (!action) return false;
    this.current = action; this.emit(); return true;
  }
  sleep() {
    if (['listening', 'speaking'].includes(this.currentMode)) return false;
    this.sleeping = true; this.current = this.actions.find(a => a.label === '睡觉-开始') || this.idle; this.emit(); return true;
  }
  wake() { this.sleeping = false; this.current = this.actions.find(a => a.label === '睡觉-起来') || this.idle; this.emit(); }
  ended() {
    this.current = this.sleeping ? this.actions.find(a => a.label === '睡觉-循环') || this.idle : this.idle; this.emit();
  }
  mode(mode) {
    this.currentMode = mode;
    if (mode === 'thinking') this.current = this.actions.find(a => /工作状态-思考/.test(a.label)) || this.idle;
    else if (mode === 'speaking') this.current = this.actions.find(a => /碎碎念-对屏/.test(a.label)) || this.idle;
    else this.current = this.sleeping ? this.actions.find(a => a.label === '睡觉-循环') || this.idle : this.idle;
    this.emit();
  }
  reset() { this.sleeping = false; this.currentMode = 'idle'; this.current = this.idle; this.emit(); }
}
