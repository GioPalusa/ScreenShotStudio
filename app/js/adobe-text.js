// Adobe's text interchange -> editable native text. No DOM or host dependencies.
const number=(value,fallback)=>Number.isFinite(value)?value:Number.isFinite(value?.value)?value.value:fallback;
const breaks=text=>text.replace(/\r\n?/g,'\n').replace(/[\u0003\u2028\u2029]/g,'\n');
const weights={thin:100,extralight:200,light:300,normal:400,regular:400,medium:500,semibold:600,demibold:600,bold:700,extrabold:800,heavy:800,black:900};
function typography(value) {
  const fontFamily=value.fontFamily??value.adbeFont?.family;
  if(typeof fontFamily!=='string'||!fontFamily.trim()||fontFamily.length>300)throw Error('Illustrator did not include a valid font family for this text.');
  const size=number(value.fontSize,24);if(size<=0||size>12000)throw Error('The copied text has an invalid font size.');
  const face=value.fontWeight??value.adbeFont?.style??'regular',key=String(face).toLowerCase().replace(/[\s-]/g,'').replace(/italic|oblique/g,'');
  const weight=Math.max(100,Math.min(900,Number(face)||weights[key]||400));
  const leading=number(value.lineHeight,size*number(value.adbeParaAutoLeading,120)/100),lineHeight=value.lineHeight?.type==='percent'?leading/100:leading/size;
  if(!(lineHeight>0&&lineHeight<=20))throw Error('The copied text has invalid line spacing.');
  const rgb=(Array.isArray(value.color)?value.color:[value.color]).find(c=>c?.mode==='RGB')?.value;
  const color=rgb&&['r','g','b'].every(k=>Number.isFinite(rgb[k]))?'#'+['r','g','b'].map(k=>Math.round(Math.max(0,Math.min(255,rgb[k]))).toString(16).padStart(2,'0')).join(''):'#000000';
  const letterSpacing=number(value.adbeTracking,0)*size/1000;if(!Number.isFinite(letterSpacing)||Math.abs(letterSpacing)>12000)throw Error('The copied text has invalid character spacing.');
  return {fontFamily:fontFamily.trim(),size,weight,lineHeight,color,figmaText:{vertical:'TOP',baselineRatio:1,letterSpacing,italic:/italic|oblique/i.test(value.fontStyle??value.adbeFont?.style??'')}};
}
export function parseAdobeText(source) {
  if(typeof source!=='string'||source.length>8*1024*1024)throw Error('Choose copied text smaller than 8 MB.');
  let data;try{data=JSON.parse(source);}catch{throw Error('Illustrator supplied invalid formatted text.');}
  if(!data||!Array.isArray(data.paragraphs)||!data.paragraphs.length||data.paragraphs.length>1000||!data.styles||typeof data.styles!=='object')throw Error('Illustrator supplied an unsupported text structure.');
  if(data.adbeIdsnTextDirection&&data.adbeIdsnTextDirection!=='HORIZONTAL_TYPE')throw Error('Vertical Illustrator text is not supported yet.');
  const style=names=>{
    if(names!==undefined&&(!Array.isArray(names)||names.length>100))throw Error('Illustrator supplied invalid text styles.');
    const result=Object.create(null);for(const name of names??[]){const value=Object.hasOwn(data.styles,name)?data.styles[name]?.value:null;if(!value||typeof value!=='object'||Array.isArray(value))throw Error('A copied Illustrator text style is missing.');Object.assign(result,value);}return result;
  };
  let characters=0,runs=0;
  const paragraphs=data.paragraphs.map(paragraph=>{
    if(typeof paragraph.text!=='string'||(characters+=paragraph.text.length)>250000||!Array.isArray(paragraph.runs)||(runs+=paragraph.runs.length)>5000)throw Error('Copy up to 250,000 characters and 5,000 text runs.');
    const base=style(paragraph.styles),text=paragraph.text,sourceRuns=paragraph.runs.length?paragraph.runs:[{from:0,to:text.length,styles:[]}];
    let cursor=0;const parts=[];
    for(const run of sourceRuns){
      if(!Number.isInteger(run.from)||!Number.isInteger(run.to)||run.from<cursor||run.to<run.from||run.to>text.length+1)throw Error('Illustrator supplied invalid text ranges.');
      const appearance=typography({...base,...style(run.styles)}),end=Math.min(text.length,run.to);
      if(run.from>cursor)parts.push({text:breaks(text.slice(cursor,run.from)),style:appearance});
      parts.push({text:breaks(text.slice(run.from,end)),style:appearance});cursor=end;
    }
    if(cursor<text.length)parts.push({text:breaks(text.slice(cursor)),style:parts.at(-1).style});
    return {runs:parts,align:/CENTER/i.test(base.adbeParaAlignment??'')?'center':/RIGHT/i.test(base.adbeParaAlignment??'')?'end':'start',before:Math.max(0,number(base.adbeSpaceBefore,0)),after:Math.max(0,number(base.adbeSpaceAfter,0))};
  });
  return {paragraphs};
}

/** Measure only after the original fonts or chosen replacements are available. */
export function layoutAdobeText(document,measure) {
  const layers=[],texts={},first=document.paragraphs[0],firstStyle=first.runs[0].style;
  const same=JSON.stringify(firstStyle),uniform=document.paragraphs.every(p=>p.align===first.align&&!p.before&&!p.after&&p.runs.every(r=>JSON.stringify(r.style)===same));
  function add(text,style,x,y,w,h,align='start') {
    const id=`illustrator-text-${layers.length+1}`,field=id;texts[field]=text;
    layers.push({id,name:'Illustrator text',type:'text',field,...structuredClone(style),x,capTop:y,w,boxHeight:h,minSize:style.size,maxLines:0,balanced:false,align,block:align});
  }
  if(uniform){
    const text=document.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'),lines=text.split('\n');
    const width=Math.max(1,...lines.map(line=>measure(line,firstStyle)))+1,height=lines.length*firstStyle.size*firstStyle.lineHeight;
    add(text,firstStyle,0,0,width,height,first.align);return {layers,texts,width,height};
  }
  const paragraphs=document.paragraphs.map(p=>{
    const lines=[[]];for(const run of p.runs)run.text.split('\n').forEach((text,i)=>{if(i)lines.push([]);lines.at(-1).push({text,style:run.style,w:measure(text,run.style)});});
    return {...p,lines:lines.map(parts=>({parts,w:parts.reduce((sum,p)=>sum+p.w,0),size:Math.max(...parts.map(p=>p.style.size)),height:Math.max(...parts.map(p=>p.style.size*p.style.lineHeight))}))};
  });
  const width=Math.max(1,...paragraphs.flatMap(p=>p.lines.map(l=>l.w)))+1;let y=0;
  for(const paragraph of paragraphs){
    y+=paragraph.before;
    for(const line of paragraph.lines){let x=paragraph.align==='center'?(width-line.w)/2:paragraph.align==='end'?width-line.w:0;
      for(const part of line.parts){if(part.text)add(part.text,part.style,x,y+line.size-part.style.size,Math.max(1,part.w)+1,part.style.size*part.style.lineHeight);x+=part.w;}y+=line.height;
    }
    y+=paragraph.after;
  }
  return {layers,texts,width,height:Math.max(1,y)};
}
