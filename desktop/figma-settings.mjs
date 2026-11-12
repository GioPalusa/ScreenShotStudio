import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const fail = message => Object.assign(Error(message), {status:401,code:'figma-auth'});

export function createFigmaKeychain({root,userData,packaged=false,serviceName='se.palusa.screenshotstudio.figma'}) {
  let helperPromise;
  const helper=()=>helperPromise??=(async()=>{
    const bundled=path.join(root,'desktop/keychain-helper');
    if(packaged){if(!fs.existsSync(bundled))throw Error('Keychain helper is missing. Rebuild the app.');return bundled;}
    fs.mkdirSync(userData,{recursive:true});const destination=path.join(userData,'figma-keychain-helper');
    await exec('/usr/bin/xcrun',['swiftc',path.join(root,'desktop/keychain.swift'),'-o',destination],{timeout:60000});return destination;
  })();
  return async(operation,value='')=>{
    const binary=await helper();
    return new Promise((resolve,reject)=>{
      const child=spawn(binary,[operation,serviceName,'figma'],{stdio:['pipe','pipe','pipe']}),chunks=[];let size=0;
      const timer=setTimeout(()=>{child.kill();reject(Error('Keychain access timed out.'));},30000);
      child.stdout.on('data',bytes=>{size+=bytes.length;if(size>4096)child.kill();else chunks.push(bytes);});
      child.stderr.resume();child.stdin.on('error',()=>{});
      child.on('error',()=>{clearTimeout(timer);reject(Error('macOS Keychain is unavailable.'));});
      child.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(chunks).toString()):reject(Error('Unlock macOS Keychain and allow Screenshot Studio access.'));});
      child.stdin.end(value);
    });
  };
}

/** Only non-secret connection status leaves this store. Tokens remain native. */
export function createFigmaSettings({keychain,now=Date.now}) {
  let queue=Promise.resolve();
  const serialized=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const read=async()=>{const value=await keychain('read');return value?JSON.parse(value):null;};
  function status(value){
    const expired=Boolean(value?.expiresAt&&new Date(value.expiresAt).getTime()<=now());
    return {stored:Boolean(value?.token),expiresAt:value?.expiresAt??null,expired,invalid:Boolean(value?.invalidAt),savedAt:value?.savedAt??null};
  }
  return {
    load:()=>serialized(async()=>status(await read())),
    forget:()=>serialized(()=>keychain('delete')),
    setExpiry:expiresAt=>serialized(async()=>{
      const value=await read();if(!value?.token)throw Error('Save a working key first.');
      const time=expiresAt?new Date(expiresAt).getTime():null;
      if(time!==null&&(!Number.isFinite(time)||time>now()+91*86400000))throw Error('Choose a valid expiry date within 90 days.');
      await keychain('write',JSON.stringify({...value,expiresAt:time===null?null:new Date(time).toISOString()}));
      return status({...value,expiresAt:time===null?null:new Date(time).toISOString()});
    }),
    request:(input,request)=>serialized(async()=>{
      const stored=await read(),provided=typeof input.token==='string'?input.token.trim():'';
      const token=provided||stored?.token;
      if(!token)throw fail('Enter a Figma personal access token with file_content:read permission.');
      if(token.length>2048||/[\r\n]/.test(token))throw fail('Enter a valid Figma personal access token.');
      if(!provided&&(status(stored).expired||stored.invalidAt))throw fail('The saved Figma key has expired or been revoked. Replace it to continue with this selection.');
      let expiresAt=provided?null:stored?.expiresAt??null;
      if(provided&&input.expiresAt){const time=new Date(input.expiresAt).getTime();if(!Number.isFinite(time)||time<=now()||time>now()+91*86400000)throw Object.assign(Error('Choose the key’s actual expiry date, within 90 days.'),{status:400});expiresAt=new Date(time).toISOString();}
      try {
        const result=await request({...input,token});
        if(provided)await keychain('write',JSON.stringify({token,expiresAt,savedAt:new Date(now()).toISOString()}));
        return result;
      } catch(error){
        if(error.code==='figma-auth'&&!provided&&stored)await keychain('write',JSON.stringify({...stored,invalidAt:new Date(now()).toISOString()}));
        throw error;
      }
    }),
  };
}
