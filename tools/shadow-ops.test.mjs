import test from 'node:test';import assert from 'node:assert/strict';
import {shadowPolar,shadowFromPolar,shadowPreset,shadowPresetId,SHADOW_PRESETS} from '../app/js/shadow-ops.js';
test('shadow distance and direction preserve the other polar component and source paint',()=>{
 const s={color:'#aabbcc',alpha:.4,blur:12,dx:-3,dy:4};const p=shadowPolar(s);assert.equal(p.distance,5);assert.ok(Math.abs(p.angle-126.86989765)<1e-6);
 const moved=shadowFromPolar(s,{distance:10});assert.equal(moved.dx,-6);assert.equal(moved.dy,8);assert.equal(moved.blur,12);assert.equal(moved.color,s.color);assert.equal(s.dx,-3);
 const turned=shadowFromPolar(moved,{angle:270});assert.equal(turned.dx,0);assert.equal(turned.dy,-10);
});
test('zero-distance shadows retain direction for subsequent distance changes',()=>{
 const zero=shadowFromPolar({blur:20,dx:0,dy:0},{angle:45});assert.equal(shadowPolar(zero).angle,45);const next=shadowFromPolar(zero,{distance:20});assert.ok(Math.abs(next.dx-next.dy)<1e-5);assert.ok(Math.abs(Math.hypot(next.dx,next.dy)-20)<.001);
});
test('presets are independent editable values and recognise custom changes',()=>{
 for(const p of SHADOW_PRESETS){const s=shadowPreset(p.id);assert.equal(shadowPresetId(s),p.id);s.blur+=1;assert.equal(shadowPresetId(s),'custom');assert.equal(shadowPreset(p.id).blur,p.shadow.blur);}assert.throws(()=>shadowPreset('unknown'));
});
