import test from 'node:test';
import assert from 'node:assert/strict';
import { frameTarget, frameCompatibility, framesForTarget, frameDropdownOptions } from '../app/js/frame-matching.js';
import { frameKey, parseFrameKey, frameScreenSize, frameOuterSize } from '../app/js/frames.js';
import { genericFrame, genericGeometry } from '../app/js/generic-frame.js';

const bezel = (w, h, label) => ({ size: [w + 100, h + 200], screen: { x: 50, y: 100, w, h }, ...(label ? { label } : {}) });
const frames = {
  'aw-ultra-black': bezel(422, 514, 'AW Ultra Black'),
  'watch-series': bezel(416, 496, 'Apple Watch Series'),
  'phone-orange': bezel(1206, 2622, 'iPhone Orange'),
  'ipad-pro': bezel(1640, 2360, 'iPad Pro'),
};
const watch = { label: 'Apple Watch', size: [422, 514], target: 'watch', capture: 'apple-watch', frame: { type: 'plain' } };
const project = { devices: { watch } };

test('Watch recommendations use exact screen dimensions, ahead of other Watch sizes and phone frames', () => {
  const target = frameTarget(project, watch, {}, frames);
  assert.deepEqual(target, { label: 'Apple Watch', screen: [422, 514], family: 'watch' });
  const choices = framesForTarget(target, frames);
  assert.deepEqual(choices.filter(c => c.fit.kind === 'exact').map(c => c.ref.name), ['aw-ultra-black']);
  assert.equal(choices[0].fit.label, 'Exact screen match');
  assert.equal(choices.find(c => c.ref.name === 'watch-series').fit.kind, 'alternative');
  assert.equal(choices.find(c => c.ref.name === 'phone-orange').fit.label, 'Different device');
  assert.ok(choices.findIndex(c => c.ref.name === 'watch-series') < choices.findIndex(c => c.ref.name === 'phone-orange'));
});

test('displayed hardware takes precedence over canvas target, screenshot collection and a mismatched layer frame', () => {
  const target = frameTarget(project, watch, { profile: 'iphone', captureSet: 'apple-watch', frame: { type: 'bezel', name: 'aw-ultra-black' } }, frames);
  assert.equal(target.family, 'iphone');assert.deepEqual(target.screen, [1206, 2622]);
  assert.deepEqual(framesForTarget(target, frames).filter(c => c.fit.kind === 'exact').map(c => c.ref.name), ['phone-orange']);
  const tablet = frameTarget(project, watch, { profile: 'ipad' }, frames);
  assert.deepEqual(tablet.screen, [1640, 2360]);assert.equal(tablet.family, 'ipad');
});

test('a wrong canvas frame does not turn a Watch into an iPhone recommendation target', () => {
  const target = frameTarget(project, { ...watch, frame: { type: 'bezel', name: 'phone-orange' } }, {}, frames);
  assert.deepEqual(target.screen, [422, 514]);assert.equal(target.family, 'watch');
  assert.equal(framesForTarget(target, frames)[0].ref.name, 'aw-ultra-black');
});

test('iPad uses its hardware screen rather than export dimensions and Duo orientation is respected', () => {
  const tablet = frameTarget(project, { label: 'iPad', size: [2064, 2752], frame: { type: 'bezel', name: 'ipad-pro' } }, {}, frames);
  assert.deepEqual(tablet.screen, [1640, 2360]);
  const duo = frameTarget(project, { label: 'Duo open', size: [1000, 1000], frame: { type: 'duo', display: 'inner', orientation: 'landscape' } });
  const choices = framesForTarget(duo);
  assert.equal(choices.filter(c => c.ref.type === 'duo').length, 0, 'Duo illustrations are no longer offered');
  assert.equal(frameCompatibility({ type: 'duo', display: 'outer' }, duo).label, 'Different device');
});

test('plain screenshots and similar proportions never claim to be an exact hardware match', () => {
  const target = frameTarget(project, watch, {}, frames);
  assert.equal(frameCompatibility({ type: 'plain' }, target, frames).kind, 'plain');
  const scaled = { unknown: bezel(844, 1028), broken: { screen: {} } };
  assert.equal(framesForTarget(target, scaled).find(c => c.ref.name === 'unknown').fit.label, 'Same proportions · scaled');
  assert.equal(framesForTarget(target, {}).filter(c => c.fit.kind === 'exact').length, 0);
  assert.equal(framesForTarget(target, scaled).find(c => c.ref.name === 'broken').fit.kind, 'other');
});

test('same dimensions cannot recommend a clearly different hardware family', () => {
  const frames = { tv: bezel(3840, 2160, 'Apple TV'), vision: bezel(3840, 2160, 'Apple Vision Pro') };
  const target = frameTarget(project, watch, { profile: 'vision' }, frames);
  assert.deepEqual(framesForTarget(target, frames).filter(c => c.fit.kind === 'exact').map(c => c.ref.name), ['vision']);
});

test('recommendations are read-only and use the screen opening, not the outer bezel or filename alone', () => {
  const before = structuredClone({ project, frames });
  const target = frameTarget(project, watch, {}, frames);
  const anonymous = { whatever: { size: [1206, 2622], screen: { w: 422, h: 514 } } };
  assert.equal(framesForTarget(target, anonymous)[0].fit.kind, 'exact');
  assert.deepEqual({ project, frames }, before);
});

test('dropdown starts with No frame and Generic frame, followed only by frames for the displayed device', () => {
  const target = frameTarget(project, watch, {}, frames);
  const options = frameDropdownOptions(target, frames);
  assert.deepEqual(options.map(o => o.label), ['No frame', 'Generic frame', 'AW Ultra Black', 'Apple Watch Series']);
  assert.deepEqual(options[0].ref, { type: 'plain', screen: [422, 514] });
  assert.deepEqual(options[1].ref, { type: 'generic', screen: [422, 514], family: 'watch' });
  const phone = frameDropdownOptions(frameTarget(project, watch, { profile: 'iphone' }, frames), frames);
  assert.deepEqual(phone.map(o => o.label), ['No frame', 'Generic frame', 'iPhone Orange']);
  assert.deepEqual(phone[1].ref.screen, [1206, 2622]);
  assert.equal(framesForTarget(target, frames).some(o => o.ref.name === 'ipad-pro'), true, 'Full picker keeps other device styles');
});

test('generic frame keeps screen geometry and has distinct stable references for each device style', () => {
  for (const [family, screen] of [['iphone', [1206, 2622]], ['ipad', [1640, 2360]], ['watch', [422, 514]], ['mac', [2880, 1800]]]) {
    const ref = genericFrame({ screen, family }), geometry = genericGeometry(ref);
    assert.deepEqual(parseFrameKey(frameKey(ref)), ref);
    assert.deepEqual(frameScreenSize(ref), screen);
    assert.deepEqual(frameOuterSize(ref), geometry.size);
    assert.ok(geometry.size.every((v, i) => v === screen[i] + geometry.rim * 2));
    assert.equal(frameCompatibility(ref, { screen, family }).kind, 'exact');
    assert.notEqual(frameKey(ref), frameKey({ type: 'plain', screen }));
  }
  assert.notEqual(frameKey(genericFrame({ screen: [3840, 2160], family: 'tv' })), frameKey(genericFrame({ screen: [3840, 2160], family: 'vision' })));
});

test('dropdown offers both built-in choices without imports and recovers screen dimensions for a missing default bezel', () => {
  const target = frameTarget(project, { ...watch, frame: { type: 'bezel', name: 'missing' } });
  assert.deepEqual(target.screen, watch.size);
  assert.deepEqual(frameDropdownOptions(target).map(o => o.label), ['No frame', 'Generic frame']);
});
