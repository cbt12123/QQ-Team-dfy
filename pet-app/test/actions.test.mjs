import test from 'node:test';
import assert from 'node:assert/strict';
import { PetActions } from '../public/actions.js';

const assets = [{ id: 'idle', label: '待机', group: '基础' }, { id: 'wave', label: '挥手', group: '互动' },
  { id: 'sleep-start', label: '睡觉-开始', group: '睡觉' }, { id: 'sleep-loop', label: '睡觉-循环', group: '睡觉' },
  { id: 'sleep-end', label: '睡觉-起来', group: '睡觉' }];
test('actions replace rather than queue, complete to idle, and sleep can be awakened', () => {
  const pet = new PetActions(assets);
  pet.play('wave'); pet.play('wave'); pet.ended();
  assert.equal(pet.state.action.id, 'idle');
  pet.sleep(); assert.equal(pet.state.action.id, 'sleep-start');
  pet.ended(); assert.equal(pet.state.action.id, 'sleep-loop');
  assert.equal(pet.play('wave'), false);
  pet.wake(); assert.equal(pet.state.action.id, 'sleep-end');
  pet.ended(); assert.equal(pet.state.action.id, 'idle');
});
test('listening and speaking block interactive effects, and reduced motion preserves semantic feedback', () => {
  const pet = new PetActions(assets, { reducedMotion: true });
  pet.mode('listening'); assert.equal(pet.play('wave'), false);
  pet.mode('speaking'); assert.equal(pet.play('wave'), false);
  pet.mode('idle'); assert.equal(pet.play('wave'), true);
  assert.equal(pet.state.animate, false);
  assert.equal(pet.state.action.label, '挥手');
  pet.reset(); assert.equal(pet.state.action.id, 'idle');
});
