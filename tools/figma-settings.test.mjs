import test from 'node:test';
import assert from 'node:assert/strict';
import { createFigmaSettings } from '../desktop/figma-settings.mjs';

test('Figma key is retained only in Keychain, reused natively and forgotten explicitly',async()=>{
  let secret='';const keychain=async(op,value)=>op==='read'?secret:op==='write'?(secret=value):(secret='');
  const settings=createFigmaSettings({keychain,now:()=>Date.parse('2026-11-12T10:00:00Z')}),calls=[];
  assert.deepEqual((await settings.load()).stored,false);
  await settings.request({token:'fixture-personal-key',expiresAt:'2026-12-01'},async input=>{calls.push(input.token);return {frames:[]};});
  const status=await settings.load();assert.equal(status.stored,true);assert.ok(!JSON.stringify(status).includes('fixture-personal-key'));
  const reopened=createFigmaSettings({keychain});await reopened.request({},async input=>{calls.push(input.token);return {};});
  assert.deepEqual(calls,['fixture-personal-key','fixture-personal-key']);
  await reopened.forget();assert.equal((await settings.load()).stored,false);
});

test('known expiry and server-rejected saved keys require replacement; access errors retain the connection',async()=>{
  let secret='',clock=Date.parse('2026-11-12T10:00:00Z');const keychain=async(op,value)=>op==='read'?secret:op==='write'?(secret=value):(secret='');
  const settings=createFigmaSettings({keychain,now:()=>clock});
  await settings.request({token:'old-key',expiresAt:'2026-11-13'},async()=>({}));clock+=2*86400000;
  let fetched=false;await assert.rejects(settings.request({},async()=>{fetched=true;}),/expired/);assert.equal(fetched,false);assert.equal((await settings.load()).expired,true);
  await settings.request({token:'new-key'},async()=>({}));assert.equal((await settings.load()).expired,false);
  await assert.rejects(settings.request({},async()=>{throw Object.assign(Error('No file permission'),{status:403});}),/file permission/);assert.equal((await settings.load()).invalid,false);
  await assert.rejects(settings.request({},async()=>{throw Object.assign(Error('Expired key'),{status:401,code:'figma-auth'});}),/Expired/);assert.equal((await settings.load()).invalid,true);
  await assert.rejects(settings.request({},async()=>({})),/expired or been revoked/);
  await settings.request({token:'replacement'},async()=>({}));assert.equal((await settings.load()).invalid,false);
  await assert.rejects(settings.request({token:'bad-replacement'},async()=>{throw Object.assign(Error('Bad key'),{code:'figma-auth'});}),/Bad key/);
  assert.equal((await settings.load()).invalid,false);assert.equal(JSON.parse(secret).token,'replacement');
});

test('expiry metadata changes without replacing or exposing the saved key',async()=>{
  let saved='';const now=()=>Date.parse('2026-11-12T10:00:00Z');const keychain=async(op,value)=>op==='read'?saved:op==='write'?(saved=value):(saved='');const settings=createFigmaSettings({keychain,now});
  await assert.rejects(settings.setExpiry(null),/Save a working key/);
  await settings.request({token:'fixture-retained-key'},async()=>({}));
  for(const days of [1,7,30,90]){const expiry=new Date(now()+days*86400000).toISOString();const status=await settings.setExpiry(expiry);assert.equal(status.expiresAt,expiry);assert.equal(status.expired,false);assert.ok(!JSON.stringify(status).includes('fixture-retained-key'));}
  assert.equal((await settings.setExpiry('2026-11-11')).expired,true);assert.equal((await settings.setExpiry(null)).expiresAt,null);assert.equal(JSON.parse(saved).token,'fixture-retained-key');
  await assert.rejects(settings.setExpiry('not-a-date'),/valid expiry/);await assert.rejects(settings.setExpiry('2027-11-12'),/valid expiry/);
});
