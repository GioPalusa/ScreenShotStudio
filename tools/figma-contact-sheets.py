"""Offline reference review; requires Pillow and NumPy in the caller's environment."""
from PIL import Image,ImageDraw
import json,sys,math,html
import numpy as np
base,label=sys.argv[1:3];out=base+'/'+label;views=json.load(open(out+'/views.json'));report=[];doc=json.load(open(out+'/Compared.sss/studio.json'))
for v in views:
 key=v['id'].replace(':','-');a=Image.open(base+'/reference-'+key+'.png').convert('RGBA');b=Image.open(out+'/studio-'+key+'.png').convert('RGBA')
 a=Image.alpha_composite(Image.new('RGBA',a.size,'white'),a).convert('RGB');b=Image.alpha_composite(Image.new('RGBA',b.size,'white'),b).convert('RGB')
 aa=np.asarray(a.resize(b.size)).astype(float);bb=np.asarray(b).astype(float);err=np.abs(aa-bb)
 mask=Image.new('L',b.size,255);draw=ImageDraw.Draw(mask);slide=next(s for s in doc['slides'] if s['id']==v['slide']);layers=slide['localeLayouts']['en-US'][v['canvas']]['layers']
 for layer in layers:
  if layer['type']!='text' or layer.get('hidden'):continue
  x,y,w,h=layer['x'],layer['capTop'],layer['w'],layer['boxHeight'];cx=x+w/2;cy=y+h/2;angle=math.radians(layer.get('rotate',0));points=[]
  for xx,yy in [(x-5,y-5),(x+w+5,y-5),(x+w+5,y+h+5),(x-5,y+h+5)]:
   u,vv=xx-cx,yy-cy;points.append((cx+u*math.cos(angle)-vv*math.sin(angle),cy+u*math.sin(angle)+vv*math.cos(angle)))
  draw.polygon(points,fill=0)
 m=np.asarray(mask)>0
 report.append({**v,'graphicsMAE':round(float(err[m].mean()),3),'graphicsChanged':round(float((err.max(axis=2)[m]>25).mean())*100,3),'referenceSize':a.size,'studioSize':b.size,'mae':round(float(err.mean()),2),'changed':round(float((err.max(axis=2)>25).mean())*100,2)})
for page in range((len(views)+11)//12):
 sheet=Image.new('RGB',(1240,1050),'#eeeeee');draw=ImageDraw.Draw(sheet)
 for j,v in enumerate(views[page*12:page*12+12]):
  x=(j%4)*310;y=(j//4)*350;key=v['id'].replace(':','-');r=report[page*12+j];draw.text((x+5,y+3),v['name']+' | Figma / Studio',fill='black');draw.text((x+5,y+19),f"MAE {r['mae']} | >25: {r['changed']}%",fill='black')
  for k,p in enumerate([base+'/reference-'+key+'.png',out+'/studio-'+key+'.png']):
   im=Image.open(p).convert('RGBA');im.thumbnail((146,305));sheet.paste(im,(x+5+k*153,y+39),im)
 sheet.save(out+f'/sheet-{page+1}.png')
json.dump(report,open(out+'/report.json','w'),indent=2)
for r in sorted(report,key=lambda x:x['mae'],reverse=True)[:25]:print(r['name'],r['mae'],r['changed'])

json.dump(report,open(out+'/graphics-report.json','w'),indent=2)
sections=[]
for v in report:
 key=v['id'].replace(':','-');name=html.escape(v['name']);sections.append(f'<article id="{key}"><h2>{name}</h2><p>Grafik: medelavvikelse {v["graphicsMAE"]}/255. Textytor undantagna från detta mått.</p><div class="pair"><figure><figcaption>Figma</figcaption><img loading="lazy" src="../reference-{key}.png" alt="Figma {name}"></figure><figure><figcaption>Screenshot Studio</figcaption><img loading="lazy" src="studio-{key}.png" alt="Studio {name}"></figure></div></article>')
style='body{font:16px system-ui;background:#f3f3f0;color:#222;margin:32px auto;max-width:1000px;padding:0 24px}p{max-width:70ch;line-height:1.5}article{margin:48px 0;border-top:1px solid #ccc;padding-top:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0}figcaption{font-weight:600;margin-bottom:12px}img{display:block;max-width:100%;height:auto}h1{font-size:28px}h2{font-size:21px}@media(max-width:600px){body{padding:0 12px}.pair{gap:12px}}'
open(out+'/report.html','w').write('<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Figma – visuell jämförelse</title><style>'+style+'</style><h1>Figma – visuell jämförelse</h1><p>Alla '+str(len(report))+' importerade vyer, med original från Figma och renderade redigerbara lager i Screenshot Studio. Fokus är ramar, blur, masker, gradienter och lager. Fontstilar ingår inte i bedömningen. Bilderna visas sida vid sida; måtten är diagnostik och innebär inte pixelidentitet.</p>'+''.join(sections)+'</html>')
