// Synthetic Illustrator text interchange. Never store user clipboard contents here.
export function adobeTextFixture({family='Arial',size=42,paragraphs=['Clear thoughts','Make room']}={}) {
  return JSON.stringify({adbeIdsnTextDirection:'HORIZONTAL_TYPE',paragraphs:paragraphs.map(text=>({text,styles:['Paragraph'],runs:[{from:0,to:text.length,styles:['Character']}]})),styles:{
    Character:{type:'application/vnd.adobe.characterstyle+json',value:{fontFamily:family,adbeFont:{family,style:'Bold'},fontSize:{type:'pt',value:size},fontWeight:'bold',lineHeight:{type:'pt',value:size*1.2},adbeTracking:0,color:[{},{mode:'RGB',value:{r:255,g:255,b:255}}]}},
    Paragraph:{type:'application/vnd.adobe.paragraphstyle+json',value:{adbeParaAlignment:'Alignment.LEFT_ALIGN',adbeSpaceBefore:{type:'pt',value:0},adbeSpaceAfter:{type:'pt',value:0}}},
  }});
}
