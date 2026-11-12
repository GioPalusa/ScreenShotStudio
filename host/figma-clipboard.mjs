import { Worker } from 'node:worker_threads';

/** Clipboard decoding is local and bounded; no clipboard HTML or schema is executed. */
export async function importFigmaClipboard(html) {
  if(typeof html!=='string'||html.length>32*1024*1024)throw Object.assign(Error('Copy a Figma selection smaller than 32 MB.'),{status:400});
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./figma-clipboard-worker.mjs',import.meta.url),{workerData:html,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}});
    const timer=setTimeout(()=>{void worker.terminate();reject(Object.assign(Error('Clipboard decoding timed out. Copy a smaller selection.'),{status:400}));},10000);
    const finish=()=>{clearTimeout(timer);void worker.terminate();};
    worker.once('message',message=>{finish();message.error?reject(Object.assign(Error(message.error),{status:400})):resolve(message.result);});
    worker.once('error',()=>{finish();reject(Object.assign(Error('This native Figma selection could not be decoded. Try Copy as SVG or import its Figma link.'),{status:400}));});
    worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(Object.assign(Error('The Figma selection exceeded the clipboard decoder limit.'),{status:400}));}});
  });
}
