import test from 'node:test';
import assert from 'node:assert/strict';
import { BURST_GAP, STEP_DISTANCE, createStepper, scrollAmount } from '../src/scroll-steps.js';

const amount = (deltaX, deltaY, natural = false) => scrollAmount({ deltaX, deltaY }, natural);

test('left and up are minus, right and down are plus, whatever the sector', () => {
  assert.ok(amount(-10, 0) < 0);
  assert.ok(amount(0, -10) < 0);
  assert.ok(amount(10, 0) > 0);
  assert.ok(amount(0, 10) > 0);
  assert.equal(amount(-10, -10), -20, 'an up-left swipe counts both axes');
  assert.equal(amount(10, -10), 0, 'an up-right swipe cancels out rather than flickering');
});

test('natural scrolling reverses the reported delta back to the hand’s direction', () => {
  assert.ok(amount(10, 0, true) < 0, 'fingers moving left report a positive deltaX');
  assert.ok(amount(0, 10, true) < 0, 'fingers moving up report a positive deltaY');
});

test('the first event of a scroll steps at once; continued scrolling steps by distance', () => {
  const stepper = createStepper();
  assert.equal(stepper.feed(4, 0), 1, 'one mouse notch is always one step');
  assert.equal(stepper.feed(4, BURST_GAP * 2), 1, 'and so is the next, however small');
  let steps = 0;
  for (let t = BURST_GAP * 2 + 10; t < BURST_GAP * 2 + 200; t += 10) steps += stepper.feed(10, t);
  assert.equal(steps, Math.floor((19 * 10) / STEP_DISTANCE), 'inside one scroll, one step per STEP_DISTANCE');
});

test('one event never steps twice', () => {
  const stepper = createStepper();
  stepper.feed(1, 0);
  assert.equal(stepper.feed(1000, 10), 1, 'a large momentum event is one step');
  assert.equal(stepper.feed(1000, 20), 1);
});

test('jitter within a scroll never steps; turning back takes the full distance', () => {
  const stepper = createStepper();
  stepper.feed(10, 0);
  let steps = 0;
  for (let t = 10; t < 160; t += 10) steps += Math.abs(stepper.feed(t % 20 ? 15 : -15, t));
  assert.equal(steps, 0, 'small pushes back and forth add up to nothing');
  assert.equal(stepper.feed(-(STEP_DISTANCE - 1), 160), 0, 'the forward push left over does not count against it');
  assert.equal(stepper.feed(-1, 170), -1);
});
