import { compositionGeometry } from '../device-compositions.js';

/** A neutral screen used by both single-slide and connected-series galleries. */
export function drawPreviewDevice(c, b, ratio, palette, frame, screenshot, px = 1) {
    c.save(); c.translate(b.cx,b.cy); c.rotate(b.rotate*Math.PI/180);
    const radius=Math.min(b.w,b.h)*(ratio >= .62 ? .065 : .105), border=Math.min(b.w,b.h)*.024;
    c.shadowColor='#00000038'; c.shadowBlur=(b.shadow?.blur ?? Math.min(b.w,b.h)*.07)*px; c.shadowOffsetY=(b.shadow?.dy ?? Math.min(b.w,b.h)*.035)*px;
    const metal=c.createLinearGradient(-b.w/2,0,b.w/2,0); metal.addColorStop(0,'#686b70');metal.addColorStop(.035,'#17191d');metal.addColorStop(.96,'#17191d');metal.addColorStop(1,'#777b82');
    c.fillStyle=metal; c.beginPath(); c.roundRect(-b.w/2,-b.h/2,b.w,b.h,radius); c.fill();
    c.shadowColor='transparent'; c.fillStyle='#f3f4f6'; c.beginPath(); c.roundRect(-b.w/2+border,-b.h/2+border,b.w-border*2,b.h-border*2,Math.max(0,radius-border)); c.fill();
    c.save(); c.beginPath(); c.roundRect(-b.w/2+border,-b.h/2+border,b.w-border*2,b.h-border*2,Math.max(0,radius-border)); c.clip();
    drawExampleScreen(c,b,palette);
    if (screenshot) {
      c.globalAlpha = 1;
      const w = b.w - border * 2, h = b.h - border * 2, scale = Math.max(w / screenshot.naturalWidth, h / screenshot.naturalHeight);
      const dw = screenshot.naturalWidth * scale, dh = screenshot.naturalHeight * scale;
      c.drawImage(screenshot, -dw / 2, -dh / 2, dw, dh);
    }
    c.restore();
    if(ratio<.62){c.fillStyle='#191b21';c.beginPath();c.roundRect(-b.w*.14,-b.h/2+border*1.7,b.w*.28,b.h*.026,b.w*.04);c.fill();}
    if(frame?.type==='duo' && frame.display==='inner'){
      c.fillStyle='#191b2118';
      if(frame.orientation==='portrait')c.fillRect(-b.w/2+border,-border/2,b.w-border*2,border);
      else c.fillRect(-border/2,-b.h/2+border,border,b.h-border*2);
    }
    c.restore();
}

/** Original sample UI, preview only. User documents never acquire demo captures. */
function drawExampleScreen(c,b,palette) {
  const w=b.w,h=b.h,x=-w*.40,content=w*.80,accent=palette.swatches?.[0]??'#879b8d';
  const rect=(x,y,w,h,r,color)=>{c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();};
  const label=(text,x,y,size,color='#202524',weight=600)=>{c.fillStyle=color;c.font=`${weight} ${size}px system-ui`;c.textAlign='left';c.fillText(text,x,y);};
  label('9:41',x,-h*.442,w*.027);
  rect(w*.28,-h*.457,w*.095,h*.007,w*.005,'#303534');
  label('YOUR SPACE',x,-h*.377,w*.026,'#717972',650);
  label('A good day.',x,-h*.325,w*.076);
  // Abstract landscape card with depth, rather than empty wireframe rectangles.
  c.save();c.beginPath();c.roundRect(x,-h*.277,content,h*.27,w*.045);c.clip();
  const sky=c.createLinearGradient(x,-h*.277,x+content,-h*.007);sky.addColorStop(0,palette.bg);sky.addColorStop(1,accent);c.fillStyle=sky;c.fillRect(x,-h*.277,content,h*.27);
  c.fillStyle='#ffffff90';c.beginPath();c.arc(w*.20,-h*.20,w*.065,0,Math.PI*2);c.fill();
  c.fillStyle=palette.ink;c.globalAlpha=.18;c.beginPath();c.ellipse(-w*.12,h*.015,w*.50,h*.15,-.2,0,Math.PI*2);c.fill();
  c.globalAlpha=.16;c.beginPath();c.ellipse(w*.30,h*.025,w*.55,h*.17,.3,0,Math.PI*2);c.fill();c.restore();
  label('Make time for you',x,h*.045,w*.045);
  label('A little inspiration for your everyday.',x,h*.076,w*.025,'#788079',400);
  for(let i=0;i<2;i++) {
    const y=h*(.115+i*.112);
    rect(x,y,content,h*.092,w*.03,'#ffffff');
    rect(x+w*.026,y+h*.017,w*.105,h*.057,w*.02,i?'#e7e5df':'#e1e9e4');
    label(i?'Saved for later':'Daily collection',x+w*.16,y+h*.037,w*.033);
    label(i?'All your favourites':'A fresh perspective',x+w*.16,y+h*.061,w*.022,'#858b87',400);
    label('›',x+content-w*.055,y+h*.052,w*.045,'#a2a8a3');
  }
  for(let i=0;i<4;i++) { c.fillStyle=i?'#c6cdc8':'#566e5d';c.beginPath();c.arc(w*(-.28+i*.185),h*.41,w*.017,0,Math.PI*2);c.fill(); }
  rect(-w*.15,h*.474,w*.3,h*.004,w*.004,'#303534');
}

/** Neutral device mockups use the exact placement maths that is saved to the document. */
export function drawCompositionPreview(canvas, { designId, size, ratio, palette, frame }) {
  const [W,H] = size, width = Math.round(190*Math.min(1,W/H)), height = Math.round(width*H/W), scale = width*2/W;
  canvas.width=width*2; canvas.height=height*2; canvas.style.width=`${width}px`; canvas.style.height=`${height}px`;
  const c=canvas.getContext('2d'); c.scale(scale,scale); c.fillStyle=palette.bg; c.fillRect(0,0,W,H);
  for (const b of compositionGeometry(designId,W,H,ratio)) {
    drawPreviewDevice(c, b, ratio, palette, frame);
  }
}
