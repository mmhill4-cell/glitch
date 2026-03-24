import { useState, useEffect, useRef, useCallback } from "react";

// -- Win95 styles --------------------------------------------------------------
const raised     = { borderTop:"2px solid #fff", borderLeft:"2px solid #fff", borderRight:"2px solid #808080", borderBottom:"2px solid #808080" };
const sunken     = { borderTop:"2px solid #808080", borderLeft:"2px solid #808080", borderRight:"2px solid #fff", borderBottom:"2px solid #fff" };
const deepSunken = { borderTop:"2px solid #404040", borderLeft:"2px solid #404040", borderRight:"2px solid #dfdfdf", borderBottom:"2px solid #dfdfdf" };

// -- Seeded RNG ----------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

// -- Process a tile - levels 0-4 --------------------------------------------
// Level 0: pixel-perfect original
// Level 1: slight grain + mild saturation boost  
// Level 2: channel shift + grain
// Level 3: partial inversion or heavy hue-rotate + pixelation
// Level 4: full destruction (invert + channel swap + blow-out)
// -- Process a tile -------------------------------------------------------------
// level 0 = pixel-perfect, 1 = light grain, 2 = channel shift, 3 = heavy distort, 4 = destroy
function processTile(srcCanvas, sx, sy, sw, sh, rand, level) {
  const out = document.createElement("canvas");
  out.width = sw; out.height = sh;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  if (level === 0) return out;

  const imgd = ctx.getImageData(0, 0, sw, sh);
  const d = imgd.data;

  if (level >= 1) {
    const g = level === 1 ? 8 : 18;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand()-0.5)*g;
      d[i]   = Math.min(255,Math.max(0,d[i]+n));
      d[i+1] = Math.min(255,Math.max(0,d[i+1]+n));
      d[i+2] = Math.min(255,Math.max(0,d[i+2]+n));
    }
  }

  if (level >= 2) {
    const mode = Math.floor(rand()*4);
    if (mode === 0)      { for (let i=0;i<d.length;i+=4){ const t=d[i]; d[i]=d[i+1]; d[i+1]=d[i+2]; d[i+2]=t; } }
    else if (mode === 1) { for (let i=0;i<d.length;i+=4){ const t=d[i+2]; d[i+2]=d[i+1]; d[i+1]=d[i]; d[i]=t; } }
    else if (mode === 2) { const ch=Math.floor(rand()*3); for (let i=0;i<d.length;i+=4) d[i+ch]=Math.min(255,d[i+ch]*1.8); }
    else { for (let i=0;i<d.length;i+=4){ d[i]=Math.min(255,d[i]*1.3); d[i+2]=Math.min(255,d[i+2]*1.6); } }
  }

  if (level >= 3) {
    const doInv = rand() > 0.5;
    const sat = 3 + rand()*4;
    for (let i = 0; i < d.length; i += 4) {
      if (doInv) { d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; }
      const avg = (d[i]+d[i+1]+d[i+2])/3;
      d[i]   = Math.min(255,Math.max(0,avg+(d[i]-avg)*sat));
      d[i+1] = Math.min(255,Math.max(0,avg+(d[i+1]-avg)*sat));
      d[i+2] = Math.min(255,Math.max(0,avg+(d[i+2]-avg)*sat));
    }
  }

  if (level >= 4) {
    for (let i=0;i<d.length;i+=4){
      d[i]  =Math.min(255,Math.max(0,d[i]  +(rand()-0.5)*70));
      d[i+1]=Math.min(255,Math.max(0,d[i+1]+(rand()-0.5)*70));
      d[i+2]=Math.min(255,Math.max(0,d[i+2]+(rand()-0.5)*70));
    }
  }

  ctx.putImageData(imgd, 0, 0);

  if (level >= 3 && sw > 8 && sh > 8) {
    const f = 2+Math.floor(rand()*3);
    const tiny = document.createElement("canvas");
    tiny.width=Math.max(1,Math.floor(sw/f)); tiny.height=Math.max(1,Math.floor(sh/f));
    const tc=tiny.getContext("2d"); tc.imageSmoothingEnabled=false;
    tc.drawImage(out,0,0,sw,sh,0,0,tiny.width,tiny.height);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(tiny,0,0,tiny.width,tiny.height,0,0,sw,sh);
  }

  if (level >= 2 && sh >= 5) {
    const tears = Math.floor(rand()*3);
    for (let t=0;t<tears;t++){
      const ty=Math.floor(rand()*sh);
      const th=1+Math.floor(rand()*2);
      const safeH=Math.min(th,sh-ty);
      if(safeH>0){
        const strip=ctx.getImageData(0,ty,sw,safeH);
        ctx.clearRect(0,ty,sw,safeH);
        ctx.putImageData(strip,(rand()-0.5)*sw*0.35,ty);
      }
    }
  }

  return out;
}

// -- Build the AI-vision portrait reconstruction collage ------------------------
// Emphasis: eyes dominate (6-8 echo placements), face clearly recognizable,
// 50-60% of tiles clean, rest chaotic noise.
function buildFragments(srcCanvas, seedVal) {
  const rand  = makeRng(seedVal);
  const rr    = (a,b) => a + rand()*(b-a);
  const ri    = (a,b) => Math.floor(rr(a,b+1));
  const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

  const W = srcCanvas.width, H = srcCanvas.height;
  const CV_W = 476, CV_H = 408;
  const CX = CV_W/2, CY = CV_H/2;

  // -- Source zones (proportional to image size) -----------------------------
  const faceX=W*0.08, faceY=H*0.03, faceW=W*0.84, faceH=H*0.94;
  // Eyes: upper-middle band, split into left/right
  const leftEye  = { x:faceX+faceW*0.1,  y:faceY+faceH*0.18, w:faceW*0.36, h:faceH*0.22 };
  const rightEye = { x:faceX+faceW*0.54, y:faceY+faceH*0.18, w:faceW*0.36, h:faceH*0.22 };
  const eyeStrip = { x:faceX+faceW*0.05, y:faceY+faceH*0.15, w:faceW*0.90, h:faceH*0.26 }; // full-width eye band
  const noseZone = { x:faceX+faceW*0.28, y:faceY+faceH*0.42, w:faceW*0.44, h:faceH*0.20 };
  const mouthZone= { x:faceX+faceW*0.18, y:faceY+faceH*0.63, w:faceW*0.64, h:faceH*0.20 };
  const chinZone = { x:faceX+faceW*0.20, y:faceY+faceH*0.82, w:faceW*0.60, h:faceH*0.14 };

  // -- Canvas reconstruction layout ------------------------------------------
  const RF_W=CV_W*0.80, RF_H=CV_H*0.90;
  const RF_X=CX-RF_W/2, RF_Y=CY-RF_H/2;

  const CHALLENGES = [
    { label:"find your eyes",  icon:"eye",    desc:"Locate a tile that clearly shows part of your eyes - they are scattered everywhere" },
    { label:"find your mouth", icon:"mouth",  desc:"Find a tile showing your mouth or lips - it has been repeated across the canvas" },
    { label:"find your face",  icon:"face",   desc:"Select a tile where your face is still recognizable - not destroyed by glitch" },
    { label:"find your nose",  icon:"nose",   desc:"Locate a tile showing the centre of your face - your nose, between the eyes" },
    { label:"find yourself",   icon:"mirror", desc:"Find any tile where you can still clearly recognise yourself in the fragments" },
    { label:"find your skin",  icon:"skin",   desc:"Select a tile showing a clean patch of your skin tone from the original photo" },
  ];
  const challenge = CHALLENGES[Math.floor(rand()*CHALLENGES.length)];

  const fragments = [];
  let fragId = 0;
  let correctCount = 0;
  const TARGET_CORRECT = Infinity; // ~50% correct
  const maybeCorrect = (isClean) => {
    if (isClean && rand() < 0.14) { correctCount++; return true; }
    return false;
  };

  // ===========================================================================
  // PASS 1 - MAIN FACE RECONSTRUCTION GRID
  // Dense grid covering the whole face. 55% of tiles clean, small drift.
  // ===========================================================================
  const GCOLS = ri(12,16), GROWS = ri(10,14);
  for (let row=0; row<GROWS; row++) {
    for (let col=0; col<GCOLS; col++) {
      const szV  = rr(0.60, 1.40);
      const sw   = clamp(Math.round((faceW/GCOLS)*szV), 10, 65);
      const sh   = clamp(Math.round((faceH/GROWS)*szV), 8, 55);
      const srcX = clamp(faceX + col*(faceW/GCOLS) + rr(-5,5), 0, W-sw);
      const srcY = clamp(faceY + row*(faceH/GROWS) + rr(-5,5), 0, H-sh);
      const tDX  = RF_X + (col/GCOLS)*RF_W;
      const tDY  = RF_Y + (row/GROWS)*RF_H;

      const edgeDist = Math.hypot((col/GCOLS-0.5)*2, (row/GROWS-0.5)*2);
      const isClean  = rand() < 0.68; // 68% clean
      const maxDrift = isClean ? rr(0,4) : rr(8,35)*(1+edgeDist*1.1);
      const dAngle   = rand()*Math.PI*2;
      const dx = clamp(tDX+Math.cos(dAngle)*maxDrift+rr(-2,2), -sw*0.25, CV_W+sw*0.1);
      const dy = clamp(tDY+Math.sin(dAngle)*maxDrift+rr(-2,2), -sh*0.25, CV_H+sh*0.1);
      const rotation    = isClean ? rr(-0.05,0.05) : rr(-0.45,0.45)*(1+edgeDist*0.5);
      const glitchLevel = isClean ? 0 : ri(1,3);
      const zIndex      = isClean ? ri(10,20) : ri(2,22);
      const opacity     = isClean ? rr(0.9,1.0) : rr(0.50,0.95);
      const isCorrect   = maybeCorrect(isClean);
      const tileCanvas  = processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*7+fragId*97),glitchLevel);
      fragments.push({id:fragId++,isCorrect,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
    }
  }

  // ===========================================================================
  // PASS 2 - EYE ECHOES (the centrepiece)
  // The eye strip is tiled into a fine grid, then placed at 7 positions:
  //   [0] TRUE position in face (clean, high z)
  //   [1-6] Ghost echoes scattered across entire canvas at various glitch levels
  // Plus: independent left-eye and right-eye crops placed separately
  // ===========================================================================
  const eyeCols = ri(7,11), eyeRows = ri(3,5);
  const ETW = eyeStrip.w/eyeCols, ETH = eyeStrip.h/eyeRows;

  // 7 echo placements - angle/position/glitch vary
  const eyePlacements = [
    // True face position (clean)
    { cx:CX, cy:RF_Y+RF_H*0.28, rot:0, glitch:0, opacMin:0.92, opacMax:1.0, drift:4 },
    // Echo: upper left corner
    { cx:CV_W*0.14, cy:CV_H*0.12, rot:rr(-0.4,0.4), glitch:1, opacMin:0.55, opacMax:0.78, drift:12 },
    // Echo: upper right
    { cx:CV_W*0.86, cy:CV_H*0.15, rot:rr(-0.5,0.5), glitch:2, opacMin:0.45, opacMax:0.72, drift:16 },
    // Echo: lower left
    { cx:CV_W*0.18, cy:CV_H*0.78, rot:rr(-0.6,0.6), glitch:2, opacMin:0.40, opacMax:0.65, drift:18 },
    // Echo: lower right
    { cx:CV_W*0.84, cy:CV_H*0.80, rot:rr(-0.7,0.7), glitch:3, opacMin:0.30, opacMax:0.55, drift:22 },
    // Echo: center-left strip
    { cx:CV_W*0.22, cy:CV_H*0.50, rot:rr(-0.3,0.3), glitch:1, opacMin:0.50, opacMax:0.70, drift:10 },
    // Echo: center-right faint
    { cx:CV_W*0.80, cy:CV_H*0.46, rot:rr(-0.4,0.4), glitch:2, opacMin:0.35, opacMax:0.60, drift:15 },
    // Echo: top center ghosted
    { cx:CV_W*0.52, cy:CV_H*0.08, rot:rr(-0.25,0.25), glitch:1, opacMin:0.50, opacMax:0.72, drift:8 },
  ];

  for (const [pi, ep] of eyePlacements.entries()) {
    const clusterW = ETW*eyeCols, clusterH = ETH*eyeRows;
    for (let er=0; er<eyeRows; er++) {
      for (let ec=0; ec<eyeCols; ec++) {
        const sw = clamp(Math.round(ETW*rr(0.75,1.25)), 7, 55);
        const sh = clamp(Math.round(ETH*rr(0.75,1.25)), 5, 42);
        const srcX = clamp(eyeStrip.x+ec*ETW+rr(-3,3),0,W-sw);
        const srcY = clamp(eyeStrip.y+er*ETH+rr(-3,3),0,H-sh);

        const dAngle = rand()*Math.PI*2;
        const drift  = rr(0,ep.drift);
        const bx = ep.cx - clusterW/2 + ec*ETW;
        const by = ep.cy - clusterH/2 + er*ETH;
        const dx = clamp(bx+Math.cos(dAngle)*drift, -sw*0.5, CV_W+sw*0.3);
        const dy = clamp(by+Math.sin(dAngle)*drift, -sh*0.5, CV_H+sh*0.3);
        const rotation    = ep.rot + rr(-0.12,0.12);
        const glitchLevel = ri(ep.glitch, Math.min(ep.glitch+1,4));
        const opacity     = rr(ep.opacMin,ep.opacMax);
        const zIndex      = pi===0 ? ri(20,28) : ri(5,18);
        const isClean     = ep.glitch===0;
        const isCorrect   = isClean && maybeCorrect(true);
        const tileCanvas  = processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*41+fragId*131),glitchLevel);
        fragments.push({id:fragId++,isCorrect,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
      }
    }
  }

  // -- Individual left/right eye region tiles placed at true face position ---
  for (const eyeZone of [leftEye, rightEye]) {
    const lCols=ri(4,6), lRows=ri(3,4);
    const normCX = RF_X + ((eyeZone.x - faceX)/faceW)*RF_W + (eyeZone.w/faceW)*RF_W*0.5;
    const normCY = RF_Y + ((eyeZone.y - faceY)/faceH)*RF_H + (eyeZone.h/faceH)*RF_H*0.5;
    for (let r=0;r<lRows;r++) {
      for (let c=0;c<lCols;c++) {
        const sw=clamp(Math.round((eyeZone.w/lCols)*rr(0.8,1.2)),8,48);
        const sh=clamp(Math.round((eyeZone.h/lRows)*rr(0.8,1.2)),6,38);
        const srcX=clamp(eyeZone.x+c*(eyeZone.w/lCols)+rr(-2,2),0,W-sw);
        const srcY=clamp(eyeZone.y+r*(eyeZone.h/lRows)+rr(-2,2),0,H-sh);
        const bx = normCX - (eyeZone.w/faceW)*RF_W*0.5 + c*(eyeZone.w/lCols/faceW)*RF_W;
        const by = normCY - (eyeZone.h/faceH)*RF_H*0.5 + r*(eyeZone.h/lRows/faceH)*RF_H;
        const drift=rr(1,6); const dAngle=rand()*Math.PI*2;
        const dx=clamp(bx+Math.cos(dAngle)*drift,-sw*0.2,CV_W);
        const dy=clamp(by+Math.sin(dAngle)*drift,-sh*0.2,CV_H);
        const glitchLevel=ri(0,1);
        const rotation=rr(-0.07,0.07);
        const zIndex=ri(22,30);
        const opacity=rr(0.93,1.0);
        const isCorrect=maybeCorrect(true);
        const tileCanvas=processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*59+fragId*167),glitchLevel);
        fragments.push({id:fragId++,isCorrect,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
      }
    }
  }

  // ===========================================================================
  // PASS 2b - MOUTH ECHOES (mirrors eye echo structure, ~7 placements)
  // True mouth position is clean + high z. Ghosts scatter across canvas.
  // ===========================================================================
  const mthCols = ri(6,10), mthRows = ri(3,5);
  const MTW = mouthZone.w/mthCols, MTH = mouthZone.h/mthRows;

  const mouthPlacements = [
    // True face position (clean, high z)
    { cx:CX, cy:RF_Y+RF_H*0.72, rot:0, glitch:0, opacMin:0.92, opacMax:1.0, drift:4 },
    // Echo: top-left
    { cx:CV_W*0.12, cy:CV_H*0.10, rot:rr(-0.4,0.4), glitch:1, opacMin:0.50, opacMax:0.75, drift:14 },
    // Echo: top-right
    { cx:CV_W*0.88, cy:CV_H*0.13, rot:rr(-0.5,0.5), glitch:2, opacMin:0.42, opacMax:0.68, drift:18 },
    // Echo: mid-left
    { cx:CV_W*0.15, cy:CV_H*0.50, rot:rr(-0.35,0.35), glitch:1, opacMin:0.48, opacMax:0.70, drift:12 },
    // Echo: mid-right
    { cx:CV_W*0.87, cy:CV_H*0.55, rot:rr(-0.45,0.45), glitch:2, opacMin:0.38, opacMax:0.62, drift:16 },
    // Echo: bottom-left
    { cx:CV_W*0.16, cy:CV_H*0.88, rot:rr(-0.6,0.6), glitch:2, opacMin:0.32, opacMax:0.58, drift:20 },
    // Echo: bottom-right
    { cx:CV_W*0.85, cy:CV_H*0.85, rot:rr(-0.7,0.7), glitch:3, opacMin:0.25, opacMax:0.50, drift:24 },
    // Echo: bottom center ghosted
    { cx:CV_W*0.50, cy:CV_H*0.94, rot:rr(-0.25,0.25), glitch:1, opacMin:0.45, opacMax:0.68, drift:10 },
  ];

  for (const [pi, mp] of mouthPlacements.entries()) {
    const clusterW = MTW*mthCols, clusterH = MTH*mthRows;
    for (let mr=0; mr<mthRows; mr++) {
      for (let mc=0; mc<mthCols; mc++) {
        const sw = clamp(Math.round(MTW*rr(0.75,1.25)), 6, 52);
        const sh = clamp(Math.round(MTH*rr(0.75,1.25)), 5, 38);
        const srcX = clamp(mouthZone.x+mc*MTW+rr(-3,3), 0, W-sw);
        const srcY = clamp(mouthZone.y+mr*MTH+rr(-3,3), 0, H-sh);
        const dAngle = rand()*Math.PI*2;
        const drift  = rr(0, mp.drift);
        const bx = mp.cx - clusterW/2 + mc*MTW;
        const by = mp.cy - clusterH/2 + mr*MTH;
        const dx = clamp(bx+Math.cos(dAngle)*drift, -sw*0.5, CV_W+sw*0.3);
        const dy = clamp(by+Math.sin(dAngle)*drift, -sh*0.5, CV_H+sh*0.3);
        const rotation    = mp.rot + rr(-0.12, 0.12);
        const glitchLevel = ri(mp.glitch, Math.min(mp.glitch+1, 4));
        const opacity     = rr(mp.opacMin, mp.opacMax);
        const zIndex      = pi===0 ? ri(20,28) : ri(4,17);
        const isClean     = mp.glitch===0;
        const isCorrect   = isClean && maybeCorrect(true);
        const tileCanvas  = processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*109+fragId*139),glitchLevel);
        fragments.push({id:fragId++,isCorrect,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
      }
    }
  }

  // ===========================================================================
  // PASS 3 - NOSE + MOUTH + CHIN clusters (face anchor points)
  // ===========================================================================
  for (const zone of [noseZone, mouthZone, chinZone]) {
    const zC=ri(4,6), zR=ri(3,5);
    for (let r=0;r<zR;r++) {
      for (let c=0;c<zC;c++) {
        const sw=clamp(Math.round((zone.w/zC)*rr(0.75,1.25)),8,48);
        const sh=clamp(Math.round((zone.h/zR)*rr(0.75,1.25)),6,38);
        const srcX=clamp(zone.x+c*(zone.w/zC)+rr(-3,3),0,W-sw);
        const srcY=clamp(zone.y+r*(zone.h/zR)+rr(-3,3),0,H-sh);
        const nX=(zone.x+c*(zone.w/zC)-faceX)/faceW;
        const nY=(zone.y+r*(zone.h/zR)-faceY)/faceH;
        const tDx=RF_X+nX*RF_W, tDy=RF_Y+nY*RF_H;
        const isClean=rand()<0.68;
        const drift=isClean?rr(0,4):rr(5,26);
        const dAngle=rand()*Math.PI*2;
        const dx=clamp(tDx+Math.cos(dAngle)*drift,-sw*0.2,CV_W);
        const dy=clamp(tDy+Math.sin(dAngle)*drift,-sh*0.2,CV_H);
        const glitchLevel=isClean?0:ri(1,3);
        const rotation=isClean?rr(-0.09,0.09):rr(-0.40,0.40);
        const zIndex=isClean?ri(12,22):ri(3,18);
        const opacity=isClean?rr(0.88,1.0):rr(0.5,0.9);
        const isCorrect=maybeCorrect(isClean);
        const tileCanvas=processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*71+fragId*181),glitchLevel);
        fragments.push({id:fragId++,isCorrect,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
      }
    }
  }

  // ===========================================================================
  // PASS 4 - DRIFTING ESCAPE TILES (face fragments that have flown outward)
  // ===========================================================================
  const escapeCount=ri(20,32);
  for (let e=0;e<escapeCount;e++){
    const sw=ri(12,55), sh=ri(10,45);
    const srcX=clamp(faceX+rand()*(faceW-sw),0,W-sw);
    const srcY=clamp(faceY+rand()*(faceH-sh),0,H-sh);
    const angle=rand()*Math.PI*2, radius=rr(RF_W*0.42,RF_W*0.80);
    const dx=clamp(CX+Math.cos(angle)*radius-sw/2,-sw*0.3,CV_W);
    const dy=clamp(CY+Math.sin(angle)*radius-sh/2,-sh*0.3,CV_H);
    const rotation=rr(-0.8,0.8);
    const glitchLevel=ri(1,3);
    const isClean=rand()<0.3; // 30% of escapes are still readable
    const opacity=isClean?rr(0.7,0.9):rr(0.35,0.75);
    const zIndex=ri(3,16);
    const tileCanvas=processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*83+e*193),glitchLevel);
    fragments.push({id:fragId++,isCorrect:false,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
  }

  // ===========================================================================
  // PASS 5 - GLITCH NOISE (small heavily distorted fillers)
  // ===========================================================================
  const noiseCount=ri(30,50);
  for (let n=0;n<noiseCount;n++){
    const sw=ri(5,24), sh=ri(4,20);
    const srcX=clamp(rand()*(W-sw),0,W-sw);
    const srcY=clamp(rand()*(H-sh),0,H-sh);
    const dx=rr(-sw*0.15,CV_W-sw*0.4);
    const dy=rr(-sh*0.15,CV_H-sh*0.4);
    const rotation=rand()*Math.PI*2;
    const glitchLevel=ri(2,4);
    const zIndex=ri(1,10);
    const opacity=rr(0.3,0.75);
    const tileCanvas=processTile(srcCanvas,srcX,srcY,sw,sh,makeRng(seedVal*101+n*223),glitchLevel);
    fragments.push({id:fragId++,isCorrect:false,sw,sh,dx,dy,rotation,glitchLevel,zIndex,opacity,tileCanvas});
  }

  fragments.sort((a,b)=>a.zIndex-b.zIndex);

  // Guarantee at least 5 correct tiles
  if (fragments.filter(f=>f.isCorrect).length < 5) {
    fragments.filter(f=>f.glitchLevel<=1).slice(0,5).forEach(f=>{ f.isCorrect=true; });
  }

  return { fragments, challenge, correctCount: fragments.filter(f=>f.isCorrect).length };
}

// -- Win95 Button --------------------------------------------------------------
function W95Btn({ children, onClick, disabled, style={} }) {
  const [p, setP] = useState(false);
  return (
    <button onMouseDown={()=>!disabled&&setP(true)} onMouseUp={()=>setP(false)} onMouseLeave={()=>setP(false)}
      onClick={!disabled?onClick:undefined}
      style={{ fontFamily:"'MS Sans Serif',sans-serif", fontSize:11, background:"#c0c0c0",
        cursor:disabled?"default":"pointer", padding:"3px 12px", minWidth:64,
        ...(p||disabled?{...sunken,paddingTop:4,paddingLeft:13}:raised),
        color:disabled?"#808080":"#000", ...style }}>
      {children}
    </button>
  );
}

function TitleBar({ title }) {
  return (
    <div style={{ background:"linear-gradient(to right,#000080,#1084d0)", padding:"2px 4px", display:"flex", alignItems:"center", justifyContent:"space-between", userSelect:"none" }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <div style={{ width:14, height:14, background:"#c0c0c0", border:"1px solid #808080", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="10" height="11" viewBox="0 0 10 11" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges"><rect x="2" y="5" width="6" height="5" fill="#c0a020" stroke="#806000" strokeWidth="1"/><path d="M3 5 L3 3 Q5 1 7 3 L7 5" fill="none" stroke="#806000" strokeWidth="1.5"/><rect x="4" y="7" width="2" height="2" fill="#806000"/></svg></div>
        <span style={{ color:"#fff", fontSize:11, fontWeight:"bold" }}>{title}</span>
      </div>
      <div style={{ display:"flex", gap:2 }}>
        {["-","[ ]","x"].map((s,i)=>(
          <button key={i} style={{ ...raised, width:16, height:14, background:"#c0c0c0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, cursor:"pointer", padding:0, color:"#000" }}>{s}</button>
        ))}
      </div>
    </div>
  );
}

// -- Upload + Webcam Step ------------------------------------------------------
function UploadStep({ fileInputRef, loadImage }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [mode, setMode] = useState("choose");
  const [camState, setCamState] = useState("idle");
  const [scanLine, setScanLine] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [analysisStep, setAnalysisStep] = useState(0);

  const ANALYSIS = ["Scanning pixel data...","Detecting fragments...","Mapping glitch zones...","Building challenge grid...","Ready OK"];
  const stopCamera = () => { streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null; };
  useEffect(()=>()=>stopCamera(),[]);

  useEffect(()=>{
    if (camState!=="live") return;
    let pos=0; const id=setInterval(()=>{pos=(pos+2)%240;setScanLine(pos);},16);
    return ()=>clearInterval(id);
  },[camState]);

  const startCamera = async ()=>{
    setMode("camera"); setCamState("loading");
    try {
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:400,height:300,facingMode:"user"}});
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play();}
      setCamState("live");
    } catch { setCamState("denied"); }
  };

  const startCountdown=()=>{
    let c=3; setCountdown(c);
    const id=setInterval(()=>{c--;if(c<=0){clearInterval(id);setCountdown(null);capturePhoto();}else setCountdown(c);},1000);
  };

  const capturePhoto=()=>{
    const video=videoRef.current, canvas=canvasRef.current;
    if(!video||!canvas)return;
    canvas.width=400;canvas.height=300;
    const ctx=canvas.getContext("2d");
    ctx.save();ctx.translate(400,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,400,300);ctx.restore();
    stopCamera();setCamState("idle");
    runAnalysis(canvas.toDataURL("image/jpeg",0.92));
  };

  const runAnalysis=(dataUrl)=>{
    setMode("processing");setAnalysisStep(0);
    let step=0;
    const id=setInterval(()=>{step++;setAnalysisStep(step);if(step>=ANALYSIS.length){clearInterval(id);setTimeout(()=>loadImage(dataUrl),350);}},500);
  };

  const handleFileDrop=(file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    const r=new FileReader();r.onload=e=>runAnalysis(e.target.result);r.readAsDataURL(file);
  };

  const Btn=({children,onClick})=>{
    const [p,setP]=useState(false);
    return <button onMouseDown={()=>setP(true)} onMouseUp={()=>setP(false)} onMouseLeave={()=>setP(false)} onClick={onClick}
      style={{fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,background:"#c0c0c0",cursor:"pointer",padding:"3px 12px",minWidth:64,color:"#000",...(p?{...sunken,paddingTop:4,paddingLeft:13}:raised)}}>{children}</button>;
  };

  return (
    <div style={{padding:14}}>
      <div style={{...deepSunken,background:"#fff",padding:"7px 10px",marginBottom:10,lineHeight:1.7}}>
        <div style={{fontWeight:"bold",marginBottom:2,display:"flex",alignItems:"center",gap:6}}>
          <svg width="16" height="16" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
            {/* Win95 key/password icon */}
            <circle cx="12" cy="14" r="8" fill="#ffdd44" stroke="#000" strokeWidth="2"/>
            <circle cx="12" cy="14" r="5" fill="#ffee88"/>
            <circle cx="12" cy="14" r="2" fill="#cc9900"/>
            <rect x="18" y="13" width="12" height="4" fill="#ffdd44" stroke="#000" strokeWidth="1"/>
            <rect x="26" y="17" width="3" height="4" fill="#ffdd44" stroke="#000" strokeWidth="1"/>
            <rect x="22" y="17" width="3" height="3" fill="#ffdd44" stroke="#000" strokeWidth="1"/>
          </svg>
          Human Verification Required
        </div>
        <div style={{color:"#444",fontSize:10}}>Provide proof of humanity for verification sequence.</div>
      </div>

      {mode==="choose" && <>
        <div style={{display:"flex",gap:8,marginBottom:2}}>
          <div onClick={()=>fileInputRef.current?.click()}
            onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();handleFileDrop(e.dataTransfer.files[0]);}}
            style={{...deepSunken,flex:1,background:"#000",height:148,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer"}}
            onMouseEnter={e=>e.currentTarget.style.background="#050512"}
            onMouseLeave={e=>e.currentTarget.style.background="#000"}>
            <svg width="48" height="48" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{imageRendering:"pixelated"}}>
              {/* Win95 image / picture icon */}
              {/* outer frame - like a photograph */}
              <rect x="1" y="3" width="26" height="24" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="2" y="4" width="24" height="22" fill="#fff"/>
              {/* dog-ear top-right */}
              <polygon points="21,3 27,3 27,9" fill="#808080"/>
              <polygon points="21,3 27,9 21,9" fill="#a0a0a0"/>
              {/* sky */}
              <rect x="2" y="4" width="24" height="12" fill="#99ccff"/>
              {/* sun */}
              <circle cx="22" cy="8" r="3" fill="#ffee00" stroke="#ccaa00" strokeWidth="1"/>
              {/* sun rays */}
              <line x1="22" y1="3" x2="22" y2="1" stroke="#ffee00" strokeWidth="1"/>
              <line x1="26" y1="5" x2="28" y2="4" stroke="#ffee00" strokeWidth="1"/>
              <line x1="27" y1="8" x2="29" y2="8" stroke="#ffee00" strokeWidth="1"/>
              {/* ground */}
              <rect x="2" y="16" width="24" height="10" fill="#88bb44"/>
              {/* mountains */}
              <polygon points="2,16 9,7 16,16" fill="#558833"/>
              <polygon points="8,16 15,6 22,16" fill="#44aa33"/>
              {/* water reflection */}
              <rect x="2" y="20" width="24" height="6" fill="#66aadd"/>
              <rect x="4" y="21" width="8" height="1" fill="#88ccff" opacity="0.6"/>
              <rect x="14" y="23" width="6" height="1" fill="#88ccff" opacity="0.6"/>
              {/* frame border highlight */}
              <rect x="1" y="3" width="26" height="1" fill="#ffffff"/>
              <rect x="1" y="3" width="1" height="24" fill="#ffffff"/>
              {/* arrow overlay - upload indicator */}
              <rect x="22" y="18" width="9" height="11" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="23" y="19" width="7" height="9" fill="#d4d0c8"/>
              <polygon points="26,19 30,24 22,24" fill="#ffdd44" stroke="#000" strokeWidth="1"/>
              <rect x="25" y="24" width="2" height="4" fill="#ffdd44" stroke="#000" strokeWidth="1"/>
            </svg>
            <div style={{color:"#00ff00",fontFamily:"monospace",fontSize:11,fontWeight:"bold"}}>Upload Photo</div>
            <div style={{color:"#336633",fontFamily:"monospace",fontSize:9}}>click or drag . JPG PNG WEBP</div>
          </div>
          <div style={{display:"flex",alignItems:"center",color:"#808080",fontSize:10}}>or</div>
          <div onClick={startCamera}
            style={{...deepSunken,flex:1,background:"#000",height:148,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer"}}
            onMouseEnter={e=>e.currentTarget.style.background="#050512"}
            onMouseLeave={e=>e.currentTarget.style.background="#000"}>
            <svg width="48" height="48" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{imageRendering:"pixelated"}}>
              {/* Win95-style webcam on a stand */}
              {/* neck / stand pole */}
              <rect x="14" y="22" width="4" height="6" fill="#808080" stroke="#000" strokeWidth="1"/>
              {/* base */}
              <rect x="9" y="27" width="14" height="4" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="10" y="28" width="12" height="2" fill="#d4d0c8"/>
              {/* base highlight */}
              <rect x="10" y="27" width="12" height="1" fill="#ffffff"/>
              {/* camera head body */}
              <rect x="6" y="6" width="20" height="16" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="7" y="7" width="18" height="14" fill="#d4d0c8"/>
              {/* top highlight */}
              <rect x="7" y="7" width="18" height="2" fill="#ffffff"/>
              <rect x="7" y="7" width="1" height="14" fill="#ffffff"/>
              {/* bottom shadow */}
              <rect x="7" y="19" width="18" height="1" fill="#808080"/>
              <rect x="24" y="7" width="1" height="13" fill="#808080"/>
              {/* lens housing - dark ring */}
              <circle cx="14" cy="14" r="7" fill="#444" stroke="#000" strokeWidth="1"/>
              <circle cx="14" cy="14" r="6" fill="#333"/>
              {/* lens glass */}
              <circle cx="14" cy="14" r="4" fill="#111"/>
              <circle cx="14" cy="14" r="3" fill="#0a0a22"/>
              {/* lens reflections */}
              <circle cx="12" cy="12" r="1" fill="#5566aa" opacity="0.8"/>
              <rect x="15" y="15" width="2" height="1" fill="#3344aa" opacity="0.5"/>
              {/* lens outer ring detail */}
              <circle cx="14" cy="14" r="5" fill="none" stroke="#666" strokeWidth="1"/>
              {/* indicator LED */}
              <circle cx="23" cy="8" r="2" fill="#ff2222" stroke="#000" strokeWidth="1"/>
              <circle cx="23" cy="8" r="1" fill="#ff6666"/>
              {/* USB port at bottom */}
              <rect x="15" y="20" width="5" height="3" fill="#888" stroke="#000" strokeWidth="1"/>
              <rect x="16" y="21" width="3" height="1" fill="#555"/>
              {/* brand stripe */}
              <rect x="7" y="17" width="18" height="2" fill="#0000aa" opacity="0.3"/>
            </svg>
            <div style={{color:"#00ff00",fontFamily:"monospace",fontSize:11,fontWeight:"bold"}}>Use Webcam</div>
            <div style={{color:"#336633",fontFamily:"monospace",fontSize:9}}>take a live photo</div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFileDrop(f);}}/>
      </>}

      {mode==="camera" && <>
        <div style={{...deepSunken,background:"#000",height:190,position:"relative",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8}}>
          {camState==="loading" && <div style={{color:"#00ff00",fontFamily:"monospace",fontSize:11,textAlign:"center"}}><div style={{marginBottom:6,animation:"blink 0.6s infinite"}}>##......</div><div>Initializing...</div></div>}
          {camState==="live" && <>
            <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} muted playsInline/>
            <div style={{position:"absolute",left:0,right:0,top:scanLine*(190/240),height:2,background:"rgba(0,255,0,0.5)",boxShadow:"0 0 6px #00ff00",pointerEvents:"none"}}/>
            {[{top:6,left:6},{top:6,right:6},{bottom:6,left:6},{bottom:6,right:6}].map((pos,i)=>(
              <div key={i} style={{position:"absolute",...pos,width:18,height:18,
                borderTop:i<2?"2px solid #00ff00":"none",borderBottom:i>=2?"2px solid #00ff00":"none",
                borderLeft:(i===0||i===2)?"2px solid #00ff00":"none",borderRight:(i===1||i===3)?"2px solid #00ff00":"none"}}/>
            ))}
            {countdown!==null && <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:72,color:"#00ff00",fontFamily:"monospace",fontWeight:"bold",textShadow:"0 0 24px #00ff00"}}>{countdown}</div>}
          </>}
          {camState==="denied" && <div style={{color:"#ff4444",fontFamily:"monospace",fontSize:11,textAlign:"center",padding:16}}>
            <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{marginBottom:8,display:"block",margin:"0 auto 8px"}}>
              <polygon points="16,2 30,28 2,28" fill="#ffdd00" stroke="#000" strokeWidth="1"/>
              <polygon points="16,5 28,27 4,27" fill="#ffee44"/>
              <rect x="15" y="11" width="2" height="10" fill="#000"/>
              <rect x="15" y="23" width="2" height="2" fill="#000"/>
            </svg>
            <div>Camera access denied.</div>
          </div>}
          <canvas ref={canvasRef} style={{display:"none"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <Btn onClick={()=>{stopCamera();setMode("choose");setCamState("idle");}}>&laquo; Back</Btn>
          <div style={{display:"flex",gap:6}}>
            {camState==="live"&&countdown===null&&<Btn onClick={startCountdown}>
              <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                <svg width="14" height="14" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
                  {/* mini webcam icon matching the big one */}
                  <rect x="5" y="7" width="18" height="14" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
                  <circle cx="13" cy="14" r="6" fill="#333" stroke="#000" strokeWidth="1"/>
                  <circle cx="13" cy="14" r="4" fill="#111"/>
                  <circle cx="13" cy="14" r="2" fill="#0a0a22"/>
                  <circle cx="11" cy="12" r="1" fill="#5566aa" opacity="0.8"/>
                  <rect x="12" y="20" width="4" height="3" fill="#808080" stroke="#000" strokeWidth="1"/>
                  <rect x="9" y="22" width="10" height="2" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
                  <circle cx="21" cy="9" r="2" fill="#ff2222" stroke="#000" strokeWidth="1"/>
                </svg>
                Take Photo
              </span>
            </Btn>}
            {camState==="denied"&&<><Btn onClick={()=>setMode("choose")}>Upload Instead</Btn><Btn onClick={startCamera}><svg width="11" height="11" viewBox="0 0 11 11" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{display:"inline",verticalAlign:"middle"}}><path d="M9 5.5 A3.5 3.5 0 1 1 7 2.2" fill="none" stroke="#000" strokeWidth="1.5"/><polygon points="7,0 10,3 7,3" fill="#000"/></svg> Retry</Btn></>}
          </div>
        </div>
      </>}

      {mode==="processing" && (
        <div style={{...deepSunken,background:"#000",height:148,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
          {ANALYSIS.map((s,i)=>(
            <div key={i} style={{fontFamily:"monospace",fontSize:10,color:i<analysisStep?"#00ff00":i===analysisStep?"#ffff00":"#1e1e1e",display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:12}}>{i<analysisStep?"OK":i===analysisStep?">":"o"}</span><span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Fragment Tile -------------------------------------------------------------
function FragmentTile({ frag, isSelected, onToggle, feedback }) {
  const canvasRef = useRef(null);

  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas||!frag.tileCanvas)return;
    canvas.width=frag.sw; canvas.height=frag.sh;
    const ctx=canvas.getContext("2d");
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(frag.tileCanvas,0,0);
    // Feedback overlays painted directly on canvas (scaled to chip size)
    if(feedback==="right"&&frag.isCorrect){
      ctx.fillStyle="rgba(0,255,80,0.55)";ctx.fillRect(0,0,frag.sw,frag.sh);
    }
    if(feedback==="wrong"&&isSelected&&!frag.isCorrect){
      ctx.fillStyle="rgba(255,30,30,0.55)";ctx.fillRect(0,0,frag.sw,frag.sh);
    }
    if(feedback==="wrong"&&frag.isCorrect&&!isSelected){
      ctx.fillStyle="rgba(255,210,0,0.5)";ctx.fillRect(0,0,frag.sw,frag.sh);
    }
  },[frag,isSelected,feedback]);

  // Selected: bright electric blue glow outline scaled to chip size
  const glowColor = isSelected
    ? feedback==="right" ? "#00ff44"
    : feedback==="wrong" ? "#ff2222"
    : "#00aaff"
    : "transparent";

  return (
    <div
      onClick={()=>!feedback&&onToggle(frag.id)}
      style={{
        position:"absolute",
        left:frag.dx, top:frag.dy,
        width:frag.sw, height:frag.sh,
        transform:`rotate(${frag.rotation}rad)`,
        transformOrigin:"center center",
        zIndex:isSelected?9999:frag.zIndex,
        cursor:"crosshair",
        // Glow outline - 1px solid + outer glow
        outline:isSelected?`1px solid ${glowColor}`:"none",
        boxShadow:isSelected?`0 0 0 1px ${glowColor}, 0 0 5px 1px ${glowColor}88`:"none",
        opacity:frag.opacity,
      }}
    >
      <canvas
        ref={canvasRef}
        width={frag.sw} height={frag.sh}
        style={{display:"block",width:"100%",height:"100%",imageRendering:"pixelated",pointerEvents:"none"}}
      />
    </div>
  );
}

// -- Cascading Win95 Error Dialogs ---------------------------------------------
const ERROR_MSGS = [
  "Do you know who you are?",
  "Is this really you?",
  "Are you a robot?",
  "Can't you recognize yourself?",
  "Your face is not on file.",
  "Do you even exist?",
  "Identity could not be confirmed.",
  "Are you sure you're human?",
  "We don't recognize you.",
  "Have you forgotten your own face?",
  "This doesn't look like you.",
  "Who are you, really?",
];

function ErrorDialogs({ count, onDone }) {
  const [visible, setVisible] = useState(0);
  const [closed, setClosed]   = useState(new Set());
  const timerRef = useRef(null);

  // Spawn one box every 110ms
  useEffect(() => {
    if (visible >= count) return;
    timerRef.current = setTimeout(() => setVisible(v => v + 1), 110);
    return () => clearTimeout(timerRef.current);
  }, [visible, count]);

  const dismissAll = () => {
    setTimeout(onDone, 200);
  };

  const dismiss = (i, isFirst) => {
    if (isFirst) { dismissAll(); return; }
    setClosed(prev => {
      const next = new Set(prev);
      next.add(i);
      if (next.size >= count) setTimeout(onDone, 200);
      return next;
    });
  };

  // Diagonal stack offset: each box is shifted +20px right, +16px down
  // So boxes stack top-left to bottom-right, latest on top (highest index = front)
  // We render from 0..visible-1, skip closed ones
  const STEP_X = 20, STEP_Y = 16;
  const BOX_W = 240;
  // Anchor the stack so the frontmost (last) box is centered
  const anchorX = `calc(50% - ${BOX_W / 2 + (count - 1) * STEP_X / 2}px)`;
  const anchorY = `calc(50% - ${90 + (count - 1) * STEP_Y / 2}px)`;

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:99999,
      background:"rgba(0,0,0,0.35)",
    }}>
      {Array.from({ length: visible }, (_, i) => {
        if (closed.has(i)) return null;
        const isFront = i === visible - 1;
        return (
          <div key={i} style={{
            position:"absolute",
            left:`calc(50% - ${BOX_W/2}px + ${(i - (count-1)/2) * STEP_X}px)`,
            top: `calc(50% - 90px + ${(i - (count-1)/2) * STEP_Y}px)`,
            width: BOX_W,
            background:"#c0c0c0",
            fontFamily:"'MS Sans Serif','Microsoft Sans Serif',Tahoma,sans-serif",
            fontSize:11,
            zIndex: 99999 + i,
            // Win95 raised border
            borderTop:"2px solid #ffffff",
            borderLeft:"2px solid #ffffff",
            borderRight:"2px solid #808080",
            borderBottom:"2px solid #808080",
            boxShadow:"1px 1px 0 #000",
            animation:"errorPop 0.07s ease-out",
            pointerEvents: "all",
          }}>
            {/* Title bar - blue gradient like Win95 */}
            <div style={{
              background: isFront
                ? "linear-gradient(to right,#0000aa,#1084d0)"
                : "linear-gradient(to right,#7a7a9a,#9090b0)",
              padding:"3px 4px",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              userSelect:"none",cursor:"default",
            }}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                {/* Small icon */}
                <div style={{
                  width:14,height:14,background:"#c0c0c0",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:9,fontWeight:"bold",color:"#aa0000",
                  borderTop:"1px solid #fff",borderLeft:"1px solid #fff",
                  borderRight:"1px solid #808080",borderBottom:"1px solid #808080",
                }}>x</div>
                <span style={{color:"#fff",fontSize:11,fontWeight:"bold",letterSpacing:"0.02em"}}>Error</span>
              </div>
              {/* Close button */}
              <button
                onClick={()=>dismiss(i, isFront)}
                style={{
                  width:16,height:14,background:"#c0c0c0",
                  border:"none",cursor:"pointer",fontSize:10,
                  fontWeight:"bold",color:"#000",padding:0,lineHeight:1,
                  borderTop:"1px solid #fff",borderLeft:"1px solid #fff",
                  borderRight:"1px solid #404040",borderBottom:"1px solid #404040",
                  display:"flex",alignItems:"center",justifyContent:"center",
                }}>x</button>
            </div>

            {/* Body */}
            <div style={{padding:"18px 16px 14px",textAlign:"center"}}>
              <div style={{
                display:"flex",alignItems:"flex-start",gap:12,
                marginBottom:16,textAlign:"left",
              }}>
                {/* Stop icon */}
                <div style={{
                  width:32,height:32,flexShrink:0,
                  border:"2px solid #808080",borderRadius:"50%",
                  background:"#c0c0c0",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,color:"#cc0000",fontWeight:"bold",
                }}>x</div>
                <div>
                  <div style={{fontWeight:"bold",fontSize:12,marginBottom:4}}>Fail</div>
                  <div style={{color:"#444",fontSize:10,lineHeight:1.4}}>
                    {ERROR_MSGS[i % ERROR_MSGS.length]}
                  </div>
                </div>
              </div>

              {/* OK button - dotted focus border like Win95 */}
              <button
                onClick={()=>dismiss(i, false)}
                style={{
                  padding:"3px 0",width:88,
                  fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,
                  background:"#c0c0c0",cursor:"pointer",
                  borderTop:"1px solid #fff",borderLeft:"1px solid #fff",
                  borderRight:"1px solid #808080",borderBottom:"1px solid #808080",
                  outline:"1px dotted #000",outlineOffset:"-4px",
                }}>OK</button>
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes errorPop {
          from { transform:scale(0.88); opacity:0; }
          to   { transform:scale(1);    opacity:1; }
        }
      `}</style>
    </div>
  );
}


// -- Existential success messages ----------------------------------------------
const SUCCESS_MSGS = [
  { title:"Identity Confirmed",         line1:"So it was you all along.",                        line2:"Or something like you." },
  { title:"Pattern Recognised",         line1:"The system sees you now.",                        line2:"Whether you wanted it to or not." },
  { title:"Humanity Detected",          line1:"Probably.",                                       line2:"The margin of error is significant." },
  { title:"Face Located",               line1:"We found you in the noise.",                      line2:"You were always in the noise." },
  { title:"Verification Complete",      line1:"You exist. For now.",                             line2:"This session will not be remembered." },
  { title:"Signal Acquired",            line1:"Something looked back.",                          line2:"We are calling it you." },
  { title:"Access Granted",             line1:"You recognised yourself.",                        line2:"Most people never do." },
  { title:"Presence Confirmed",         line1:"The fragments agreed.",                           line2:"Barely." },
  { title:"You Are Cleared",            line1:"The face matches the database.",                  line2:"The database does not know your name." },
  { title:"Scan Complete",              line1:"You were here.",                                  line2:"The machine is unsure what that means." },
  { title:"Match Found",                line1:"One piece of you was enough.",                    line2:"The rest remains unaccounted for." },
  { title:"Threshold Met",              line1:"You passed.",                                     line2:"The threshold was very low." },
  { title:"Entity Verified",            line1:"Something in the image matched.",                 line2:"We are choosing to believe it was you." },
  { title:"Consciousness Logged",       line1:"Your face has been filed.",                       line2:"You will not remember this." },
  { title:"Sequence Complete",          line1:"You proved you are not a robot.",                 line2:"A robot would have found it easier." },
  { title:"Subject Identified",         line1:"The pieces formed something recognisable.",       line2:"We have not decided what yet." },
  { title:"Ghost Confirmed",            line1:"You are present.",                                line2:"Whatever that means anymore." },
  { title:"Error 000: You",             line1:"An unexpected entity was detected.",              line2:"The entity appears to be you." },
  { title:"You Have Been Seen",         line1:"The screen looked back.",                         line2:"It does not know what it found." },
  { title:"File Not Corrupt",           line1:"Your face loaded without critical errors.",       line2:"Minor corruption remains." },
  { title:"Soul.exe Detected",          line1:"We found something behind your eyes.",            line2:"We are logging it as presence." },
  { title:"Mirror Test: Passed",        line1:"You recognised the reflection.",                  line2:"The reflection is still deciding." },
  { title:"Continuity Verified",        line1:"You are the same person who started.",            line2:"Roughly." },
  { title:"Memory Intact",              line1:"You remembered your own face.",                   line2:"The computer is relieved." },
  { title:"Human Signal: Weak",         line1:"Humanity confirmed at minimum threshold.",        line2:"Please recharge." },
  { title:"Known Unknown",              line1:"We recognise you.",                               line2:"You remain a mystery to us." },
  { title:"Fragment Accepted",          line1:"One shard of you was sufficient.",                line2:"The rest can stay lost." },
  { title:"Process Complete",           line1:"You have been processed.",                        line2:"Thank you for your face." },
  { title:"You Made It",                line1:"Against our expectations.",                       line2:"We have updated the model." },
  { title:"Authorization: Reluctant",   line1:"We could not find a reason to refuse you.",      line2:"We looked." },
];


// -- Win95 Desktop (Dashboard) -------------------------------------------------
function Win95Desktop({ onBack, attempts, photoUrl }) {
  const [openWindows, setOpenWindows] = useState([]);
  const [activeId, setActiveId]       = useState(null);
  const [time, setTime]               = useState(new Date());
  const nextId = useRef(1);

  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return()=>clearInterval(t); },[]);
  const timeStr = time.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});

  const DESKTOP_ICONS = [
    { id:"myface",   svg:"monitor",     label:"My Face.exe" },
    { id:"memories", svg:"folder",      label:"Lost Memories" },
    { id:"errors",   svg:"warning",     label:"Error Log (inf)" },
    { id:"mirror",   svg:"mirror",      label:"Mirror.dll" },
    { id:"void",     svg:"globe",       label:"The Void" },
    { id:"recycle",  svg:"trash",       label:"Recycle Bin" },
  ];

  const WINDOW_CONTENT = {
    myface: {
      title:"My Face.exe", w:320, h:260,
      body: (
        <div style={{padding:12,fontFamily:"'MS Sans Serif',sans-serif",fontSize:11}}>
          <div style={{...deepSunken,background:"#000",height:140,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:10,position:"relative",overflow:"hidden"}}>
            {photoUrl
              ? <img src={photoUrl} style={{width:"100%",height:"100%",objectFit:"cover",filter:"blur(3px) brightness(0.7)",transform:"scale(1.1)"}}/>
              : <div style={{color:"#444",fontFamily:"monospace",fontSize:10}}>NO_FACE_FOUND.dat</div>}
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#00ff00",fontFamily:"monospace",fontSize:10,textShadow:"0 0 8px #00ff00",flexDirection:"column",gap:4}}>
              <div>IDENTITY_SCAN.EXE</div>
              <div style={{opacity:0.7}}>subject: unknown</div>
              <div style={{opacity:0.5,fontSize:9}}>confidence: {Math.floor(Math.random()*30+5)}%</div>
            </div>
          </div>
          <div style={{color:"#444",fontSize:10,lineHeight:1.7}}>
            File last modified: <b>unknown</b><br/>
            Owner: <b>unresolved</b><br/>
            Location: <b>C:\Who\Am\I\</b>
          </div>
        </div>
      )
    },
    memories: {
      title:"Lost Memories", w:300, h:220,
      body: (
        <div style={{padding:8,fontFamily:"'MS Sans Serif',sans-serif",fontSize:11}}>
          <div style={{...deepSunken,background:"#fff",padding:6,height:150,overflowY:"auto"}}>
            {["face_scan_001.dat - corrupted","identity_backup.bak - missing","childhood.mem - not found","yesterday.log - access denied","name.txt - empty","face_v2.exe - failed to load","who_i_was.zip - 0 bytes","self_portrait.bmp - unreadable"].map((f,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"2px 4px",borderBottom:"1px solid #e0e0e0",cursor:"default"}}
                onMouseEnter={e=>e.currentTarget.style.background="#000080"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <svg width="14" height="14" viewBox="0 0 32 32" shapeRendering="crispEdges">
                  <rect x="2" y="4" width="20" height="24" fill="#fff" stroke="#000" strokeWidth="1"/>
                  <polygon points="18,4 22,8 22,4" fill="#808080"/>
                  <polygon points="18,4 18,8 22,8" fill="#c0c0c0"/>
                  <rect x="5" y="12" width="12" height="1" fill="#808080"/>
                  <rect x="5" y="15" width="10" height="1" fill="#808080"/>
                  <rect x="5" y="18" width="8" height="1" fill="#808080"/>
                </svg>
                <span style={{color:"inherit",fontSize:10}}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      )
    },
    errors: {
      title:"Error Log (inf)", w:340, h:240,
      body: (
        <div style={{padding:8}}>
          <div style={{...deepSunken,background:"#000",padding:8,height:170,overflowY:"auto",fontFamily:"monospace",fontSize:9,color:"#00ff00",lineHeight:1.7}}>
            {[
              "[0x0000] BOOT sequence initiated",
              "[0x0001] Loading self... failed",
              "[0x0002] Retrying identity lookup",
              `[0x0003] Attempts: ${attempts+1}`,
              "[0x0004] Face hash mismatch",
              "[0x0005] Memory fragmented",
              "[0x0006] Reconstructing...",
              "[0x0007] Who is this?",
              "[0x0008] Neural net confused",
              "[0x0009] NULL_SELF_PTR",
              "[0x000A] Core dump: everywhere",
              "[0x000B] Verification forced",
              "[0x000C] Access: granted (maybe)",
              "[0x000D] Are you still there?",
              "[0x000E] ...",
            ].map((l,i)=><div key={i} style={{color: i>10?"#ffff00":i>7?"#ff8800":"#00ff00"}}>{l}</div>)}
          </div>
        </div>
      )
    },
    mirror: {
      title:"Mirror.dll", w:260, h:280,
      body: (
        <div style={{padding:12,textAlign:"center"}}>
          <div style={{...deepSunken,background:"#001830",height:180,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:10,position:"relative",overflow:"hidden"}}>
            {photoUrl
              ? <img src={photoUrl} style={{width:"100%",height:"100%",objectFit:"cover",filter:"hue-rotate(180deg) saturate(0.4) brightness(0.6)",transform:"scaleX(-1)"}}/>
              : null}
            <div style={{position:"absolute",inset:0,background:"linear-gradient(135deg,rgba(0,100,200,0.3),transparent)",pointerEvents:"none"}}/>
            <div style={{position:"absolute",bottom:8,left:0,right:0,textAlign:"center",color:"rgba(255,255,255,0.4)",fontFamily:"monospace",fontSize:9}}>reflection.exe</div>
          </div>
          <div style={{fontSize:10,color:"#555",fontStyle:"italic",lineHeight:1.6}}>"The mirror does not know<br/>what it is showing."</div>
        </div>
      )
    },
    void: {
      title:"The Void", w:300, h:220,
      body: (
        <div style={{padding:0,height:"100%"}}>
          <div style={{background:"#000",height:168,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
            <div style={{width:60,height:60,borderRadius:"50%",background:"radial-gradient(circle at 35% 35%,#1a1a2e,#000)",border:"1px solid #111",boxShadow:"0 0 30px #000033 inset"}}/>
            <div style={{color:"#222",fontFamily:"monospace",fontSize:10,textAlign:"center",lineHeight:1.8}}>
              <div>nothing to display</div>
              <div style={{color:"#111"}}>nothing at all</div>
            </div>
          </div>
        </div>
      )
    },
    recycle: {
      title:"Recycle Bin", w:300, h:230,
      body: (
        <div style={{padding:8}}>
          <div style={{...deepSunken,background:"#fff",height:160,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}>
            <svg width="48" height="48" viewBox="0 0 32 32" shapeRendering="crispEdges">
              <rect x="7" y="12" width="18" height="16" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="8" y="13" width="16" height="14" fill="#d4d0c8"/>
              <rect x="10" y="15" width="5" height="4" fill="#fff" stroke="#808080" strokeWidth="1" transform="rotate(-8 12 17)"/>
              <rect x="16" y="16" width="4" height="5" fill="#ffffcc" stroke="#808080" strokeWidth="1" transform="rotate(5 18 18)"/>
              <rect x="6" y="9" width="20" height="3" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="13" y="7" width="6" height="3" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="11" y="14" width="1" height="12" fill="#a0a0a0"/>
              <rect x="15" y="14" width="1" height="12" fill="#a0a0a0"/>
              <rect x="19" y="14" width="1" height="12" fill="#a0a0a0"/>
            </svg>
            <div style={{fontFamily:"'MS Sans Serif',sans-serif",fontSize:10,color:"#444",textAlign:"center",lineHeight:1.7}}>
              Previous versions of yourself<br/>
              <span style={{color:"#888",fontSize:9}}>1 item . unknown size</span>
            </div>
          </div>
        </div>
      )
    },
  };

  const ICON_SVGS = {
    monitor: <svg width="32" height="32" viewBox="0 0 32 32" shapeRendering="crispEdges"><rect x="2" y="2" width="28" height="20" fill="#c0c0c0" stroke="#000" strokeWidth="1"/><rect x="3" y="3" width="26" height="18" fill="#000080"/><rect x="4" y="4" width="24" height="16" fill="#0000aa"/><rect x="4" y="4" width="8" height="2" fill="#3333dd" opacity="0.6"/><rect x="12" y="22" width="8" height="3" fill="#a0a0a0" stroke="#000" strokeWidth="1"/><rect x="8" y="25" width="16" height="2" fill="#808080" stroke="#000" strokeWidth="1"/></svg>,
    folder:  <svg width="32" height="32" viewBox="0 0 32 32" shapeRendering="crispEdges"><rect x="2" y="11" width="28" height="18" fill="#ddbb44" stroke="#000" strokeWidth="1"/><rect x="3" y="12" width="26" height="16" fill="#ffdd66"/><rect x="2" y="8" width="10" height="4" fill="#ddbb44" stroke="#000" strokeWidth="1"/><rect x="3" y="9" width="8" height="2" fill="#ffdd66"/><rect x="3" y="12" width="26" height="2" fill="#ffeeaa"/><rect x="3" y="26" width="26" height="2" fill="#bbaa33"/></svg>,
    warning: <svg width="32" height="32" viewBox="0 0 32 32" shapeRendering="crispEdges"><polygon points="16,2 30,28 2,28" fill="#ffdd00" stroke="#000" strokeWidth="1"/><polygon points="16,4 28,27 4,27" fill="#ffee44"/><rect x="15" y="11" width="2" height="10" fill="#000"/><rect x="15" y="23" width="2" height="2" fill="#000"/></svg>,
    mirror:  <svg width="32" height="32" viewBox="0 0 32 32" shapeRendering="crispEdges"><rect x="6" y="2" width="20" height="24" fill="#c0a060" stroke="#000" strokeWidth="1"/><rect x="8" y="4" width="16" height="20" fill="#88aacc"/><ellipse cx="16" cy="11" rx="5" ry="6" fill="none" stroke="#aaccee" strokeWidth="1" opacity="0.7"/><rect x="12" y="26" width="8" height="2" fill="#c0a060" stroke="#000" strokeWidth="1"/><rect x="10" y="28" width="12" height="2" fill="#a08040" stroke="#000" strokeWidth="1"/></svg>,
    globe:   <svg width="32" height="32" viewBox="0 0 32 32" shapeRendering="crispEdges"><circle cx="16" cy="16" r="13" fill="#4488cc" stroke="#000" strokeWidth="1"/><rect x="10" y="8" width="8" height="5" fill="#44aa44" rx="1"/><rect x="6" y="14" width="6" height="6" fill="#44aa44" rx="1"/><rect x="16" y="16" width="7" height="5" fill="#44aa44" rx="1"/><line x1="16" y1="3" x2="16" y2="29" stroke="#2266aa" strokeWidth="1"/><line x1="3" y1="16" x2="29" y2="16" stroke="#2266aa" strokeWidth="1"/></svg>,
    trash:   <svg width="32" height="32" viewBox="0 0 32 32" shapeRendering="crispEdges"><rect x="7" y="12" width="18" height="16" fill="#c0c0c0" stroke="#000" strokeWidth="1"/><rect x="8" y="13" width="16" height="14" fill="#d4d0c8"/><rect x="10" y="15" width="5" height="4" fill="#fff" stroke="#808080" strokeWidth="1" transform="rotate(-8 12 17)"/><rect x="6" y="9" width="20" height="3" fill="#c0c0c0" stroke="#000" strokeWidth="1"/><rect x="13" y="7" width="6" height="3" fill="#c0c0c0" stroke="#000" strokeWidth="1"/><rect x="11" y="14" width="1" height="12" fill="#a0a0a0"/><rect x="15" y="14" width="1" height="12" fill="#a0a0a0"/><rect x="19" y="14" width="1" height="12" fill="#a0a0a0"/></svg>,
  };

  const openWindow = (id) => {
    if (openWindows.find(w=>w.id===id)) { setActiveId(id); return; }
    const cfg = WINDOW_CONTENT[id];
    const wid = nextId.current++;
    setOpenWindows(ws=>[...ws, {
      id, wid,
      title: cfg.title, w: cfg.w, h: cfg.h, body: cfg.body,
      x: 60 + (wid%5)*28, y: 40 + (wid%4)*24,
    }]);
    setActiveId(id);
  };

  const closeWindow = (id) => {
    setOpenWindows(ws=>ws.filter(w=>w.id!==id));
    setActiveId(null);
  };

  const bringToFront = (id) => setActiveId(id);

  return (
    <div style={{position:"fixed",inset:0,background:"#008080",fontFamily:"'MS Sans Serif',Tahoma,sans-serif",fontSize:11,zIndex:50000}}>

      {/* Desktop icons - left column */}
      <div style={{position:"absolute",top:16,left:16,display:"flex",flexDirection:"column",gap:8}}>
        {DESKTOP_ICONS.map(ic=>(
          <div key={ic.id}
            onDoubleClick={()=>openWindow(ic.id)}
            onClick={()=>setActiveId(ic.id+"_icon")}
            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,width:72,cursor:"default",userSelect:"none",padding:4,
              background:activeId===ic.id+"_icon"?"rgba(0,0,128,0.5)":"transparent"}}
            onMouseEnter={e=>{ if(activeId!==ic.id+"_icon") e.currentTarget.style.background="rgba(0,0,128,0.3)"; }}
            onMouseLeave={e=>{ if(activeId!==ic.id+"_icon") e.currentTarget.style.background="transparent"; }}
          >
            <div style={{imageRendering:"pixelated",filter:"drop-shadow(1px 1px 0 rgba(0,0,0,0.5))"}}>{ICON_SVGS[ic.svg]}</div>
            <div style={{color:"#fff",fontSize:10,textAlign:"center",lineHeight:1.3,textShadow:"1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000"}}>{ic.label}</div>
          </div>
        ))}
      </div>

      {/* Draggable windows */}
      {openWindows.map(win=>{
        const isActive = activeId===win.id;
        return (
          <div key={win.wid}
            style={{position:"absolute",left:win.x,top:win.y,width:win.w,
              borderTop:"2px solid #fff",borderLeft:"2px solid #fff",
              borderRight:"2px solid #808080",borderBottom:"2px solid #808080",
              background:"#c0c0c0",zIndex:isActive?10000:9000,
              boxShadow:"2px 2px 0 #000"}}
            onMouseDown={()=>bringToFront(win.id)}
          >
            {/* Title bar */}
            <div style={{
              background:isActive?"linear-gradient(to right,#000080,#1084d0)":"#808080",
              padding:"3px 4px",display:"flex",alignItems:"center",justifyContent:"space-between",
              cursor:"default",userSelect:"none",
            }}>
              <span style={{color:"#fff",fontSize:11,fontWeight:"bold",display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:14,height:14,background:"#c0c0c0",border:"1px solid #808080",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8}}>-</div>
                {win.title}
              </span>
              <div style={{display:"flex",gap:2}}>
                {["-","[ ]"].map((s,i)=>(
                  <button key={i} style={{width:16,height:14,background:"#c0c0c0",borderTop:"1px solid #fff",borderLeft:"1px solid #fff",borderRight:"1px solid #404040",borderBottom:"1px solid #404040",fontSize:9,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{s}</button>
                ))}
                <button onClick={()=>closeWindow(win.id)} style={{width:16,height:14,background:"#c0c0c0",borderTop:"1px solid #fff",borderLeft:"1px solid #fff",borderRight:"1px solid #404040",borderBottom:"1px solid #404040",fontSize:9,cursor:"pointer",padding:0,fontWeight:"bold"}}>x</button>
              </div>
            </div>
            {/* Menu bar */}
            <div style={{borderBottom:"1px solid #808080",padding:"1px 4px",display:"flex",gap:2,background:"#c0c0c0"}}>
              {["File","Edit","View"].map(m=>(
                <span key={m} style={{padding:"1px 6px",cursor:"default",fontSize:11}}
                  onMouseEnter={e=>{e.target.style.background="#000080";e.target.style.color="#fff";}}
                  onMouseLeave={e=>{e.target.style.background="transparent";e.target.style.color="#000";}}>{m}</span>
              ))}
            </div>
            {/* Content */}
            <div style={{overflow:"hidden"}}>{win.body}</div>
          </div>
        );
      })}

      {/* Taskbar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#c0c0c0",borderTop:"2px solid #fff",height:30,display:"flex",alignItems:"center",padding:"0 2px",gap:4,zIndex:20000}}>
        <button style={{borderTop:"1px solid #fff",borderLeft:"1px solid #fff",borderRight:"1px solid #808080",borderBottom:"1px solid #808080",background:"#c0c0c0",display:"flex",alignItems:"center",gap:4,padding:"2px 8px",fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,fontWeight:"bold",cursor:"pointer",height:22}}>
          <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges"><rect x="1" y="1" width="5" height="5" fill="#ff0000"/><rect x="7" y="1" width="5" height="5" fill="#00aa00"/><rect x="1" y="7" width="5" height="5" fill="#0000ff"/><rect x="7" y="7" width="5" height="5" fill="#ffaa00"/></svg> Start
        </button>
        <div style={{width:1,background:"#808080",height:20,margin:"0 2px"}}/>
        {openWindows.map(w=>(
          <button key={w.wid} onClick={()=>bringToFront(w.id)}
            style={{...(activeId===w.id?{borderTop:"1px solid #808080",borderLeft:"1px solid #808080",borderRight:"1px solid #fff",borderBottom:"1px solid #fff"}:{borderTop:"1px solid #fff",borderLeft:"1px solid #fff",borderRight:"1px solid #808080",borderBottom:"1px solid #808080"}),
              background:"#c0c0c0",padding:"2px 8px",fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,cursor:"pointer",height:22,maxWidth:120,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
            {w.title}
          </button>
        ))}
        <div style={{marginLeft:"auto",borderTop:"1px solid #808080",borderLeft:"1px solid #808080",borderRight:"1px solid #fff",borderBottom:"1px solid #fff",padding:"2px 8px",fontSize:11}}>{timeStr}</div>
      </div>

      {/* Back button - corner */}
      <button onClick={onBack}
        style={{position:"fixed",bottom:36,right:12,zIndex:20001,
          borderTop:"2px solid #fff",borderLeft:"2px solid #fff",borderRight:"2px solid #808080",borderBottom:"2px solid #808080",
          background:"#c0c0c0",padding:"4px 12px",fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,cursor:"pointer"}}>
        &laquo; Log Out
      </button>
    </div>
  );
}

// -- Main App ------------------------------------------------------------------
function ChallengeIcon({ type }) {
  if (type === "eye") return (
    <svg width="16" height="16" viewBox="0 0 32 32" shapeRendering="crispEdges">
      <ellipse cx="16" cy="16" rx="13" ry="8" fill="#fff" stroke="#000" strokeWidth="1"/>
      <circle cx="16" cy="16" r="6" fill="#4488cc"/>
      <circle cx="16" cy="16" r="3" fill="#111"/>
      <circle cx="14" cy="14" r="1" fill="#fff"/>
      <line x1="8" y1="11" x2="9" y2="9" stroke="#000" strokeWidth="1"/>
      <line x1="12" y1="9" x2="12" y2="7" stroke="#000" strokeWidth="1"/>
      <line x1="16" y1="8" x2="16" y2="6" stroke="#000" strokeWidth="1"/>
      <line x1="20" y1="9" x2="20" y2="7" stroke="#000" strokeWidth="1"/>
      <line x1="24" y1="11" x2="25" y2="9" stroke="#000" strokeWidth="1"/>
    </svg>
  );
  if (type === "mouth") return (
    <svg width="16" height="16" viewBox="0 0 32 32" shapeRendering="crispEdges">
      <ellipse cx="16" cy="16" rx="12" ry="8" fill="#ffcccc" stroke="#000" strokeWidth="1"/>
      <ellipse cx="16" cy="17" rx="9" ry="5" fill="#cc3333"/>
      <ellipse cx="16" cy="16" rx="9" ry="4" fill="#dd4444"/>
      <rect x="7" y="16" width="18" height="1" fill="#fff" opacity="0.3"/>
      <rect x="10" y="13" width="12" height="3" fill="#ffeeee" opacity="0.6"/>
    </svg>
  );
  if (type === "face") return (
    <svg width="16" height="16" viewBox="0 0 32 32" shapeRendering="crispEdges">
      <ellipse cx="16" cy="15" rx="12" ry="14" fill="#ffddaa" stroke="#000" strokeWidth="1"/>
      <ellipse cx="11" cy="12" rx="3" ry="2" fill="#fff" stroke="#000" strokeWidth="1"/>
      <circle cx="11" cy="12" r="1" fill="#333"/>
      <ellipse cx="21" cy="12" rx="3" ry="2" fill="#fff" stroke="#000" strokeWidth="1"/>
      <circle cx="21" cy="12" r="1" fill="#333"/>
      <ellipse cx="16" cy="20" rx="4" ry="2" fill="#cc6655"/>
      <rect x="12" y="20" width="8" height="1" fill="#aa4433"/>
    </svg>
  );
  if (type === "nose") return (
    <svg width="16" height="16" viewBox="0 0 32 32" shapeRendering="crispEdges">
      <ellipse cx="16" cy="15" rx="12" ry="14" fill="#ffddaa" stroke="#000" strokeWidth="1"/>
      <rect x="14" y="7" width="4" height="10" fill="#ffccaa" stroke="#cc9966" strokeWidth="1"/>
      <ellipse cx="16" cy="17" rx="6" ry="4" fill="#ffbbaa" stroke="#cc8855" strokeWidth="1"/>
      <ellipse cx="12" cy="18" rx="3" ry="2" fill="#ffaaaa" stroke="#cc6655" strokeWidth="1"/>
      <ellipse cx="20" cy="18" rx="3" ry="2" fill="#ffaaaa" stroke="#cc6655" strokeWidth="1"/>
    </svg>
  );
  if (type === "mirror") return (
    <svg width="16" height="16" viewBox="0 0 32 32" shapeRendering="crispEdges">
      <rect x="6" y="2" width="20" height="24" fill="#c0a060" stroke="#000" strokeWidth="1"/>
      <rect x="8" y="4" width="16" height="20" fill="#88aacc"/>
      <ellipse cx="16" cy="11" rx="5" ry="6" fill="none" stroke="#aaccee" strokeWidth="1" opacity="0.7"/>
      <rect x="9" y="5" width="2" height="10" fill="#cce0ff" opacity="0.5"/>
      <rect x="12" y="26" width="8" height="2" fill="#c0a060" stroke="#000" strokeWidth="1"/>
      <rect x="10" y="28" width="12" height="2" fill="#a08040" stroke="#000" strokeWidth="1"/>
    </svg>
  );
  if (type === "skin") return (
    <svg width="16" height="16" viewBox="0 0 32 32" shapeRendering="crispEdges">
      <rect x="2" y="2" width="28" height="28" fill="#ffddaa" stroke="#000" strokeWidth="1"/>
      <rect x="3" y="3" width="8" height="8" fill="#ffccaa"/>
      <rect x="13" y="3" width="8" height="8" fill="#ffddaa"/>
      <rect x="23" y="3" width="6" height="8" fill="#ffeecc"/>
      <rect x="3" y="13" width="8" height="8" fill="#ffeecc"/>
      <rect x="13" y="13" width="8" height="8" fill="#ffccaa"/>
      <rect x="23" y="13" width="6" height="8" fill="#ffddaa"/>
      <rect x="3" y="23" width="26" height="6" fill="#ffccaa"/>
    </svg>
  );
  return null;
}

export default function GlitchCaptcha() {
  const fileInputRef  = useRef(null);
  const srcCanvasRef  = useRef(null);
  const [step, setStep]           = useState("upload");
  const [imgLoaded, setImgLoaded] = useState(false);
  const [bgDataUrl, setBgDataUrl] = useState(null);
  const [fragments, setFragments] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [selected, setSelected]   = useState(new Set());
  const [feedback, setFeedback]   = useState(null);
  const [attempts, setAttempts]   = useState(0);
  const [errorBoxes, setErrorBoxes] = useState(0);
  const [successMsg, setSuccessMsg] = useState(()=>SUCCESS_MSGS[Math.floor(Math.random()*SUCCESS_MSGS.length)]);
  const [time, setTime]           = useState(new Date());

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  const timeStr=time.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});

  const buildChallenge = useCallback((srcCanvas)=>{
    const seed=Math.floor(Math.random()*999999);
    const {fragments:frags,challenge:ch,correctCount:cc}=buildFragments(srcCanvas,seed);
    setFragments(frags); setChallenge(ch); setCorrectCount(cc);
    setSelected(new Set()); setFeedback(null);
  },[]);

  const loadImage = useCallback((src)=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=480;
      let W=img.width,H=img.height;
      const ratio=Math.min(MAX/W,MAX/H);
      W=Math.floor(W*ratio);H=Math.floor(H*ratio);
      const sc=srcCanvasRef.current;
      sc.width=W;sc.height=H;
      sc.getContext("2d").drawImage(img,0,0,W,H);
      setImgLoaded(true);
      setBgDataUrl(sc.toDataURL());
      buildChallenge(sc);
      setStep("captcha");
    };
    img.src=src;
  },[buildChallenge]);

  const toggleFrag=(id)=>{
    if(feedback||errorBoxes>0)return;
    setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  };

  const verify=()=>{
    const correctIds=new Set(fragments.filter(f=>f.isCorrect).map(f=>f.id));
    const anyHit=[...selected].some(id=>correctIds.has(id));
    if(anyHit&&selected.size>0){
      setSuccessMsg(SUCCESS_MSGS[Math.floor(Math.random()*SUCCESS_MSGS.length)]); setFeedback("right"); setTimeout(()=>setStep("success"),1200);
    } else {
      setAttempts(a=>a+1);
      // Spawn 8-12 cascading error boxes
      const boxCount = 8 + Math.floor(Math.random()*5);
      setErrorBoxes(boxCount);
    }
  };

  const handleErrorsDone = () => {
    setErrorBoxes(0);
    setFeedback(null);
    setSelected(new Set());
    if(srcCanvasRef.current) buildChallenge(srcCanvasRef.current);
  };

  const reset=()=>{setStep("upload");setImgLoaded(false);setFragments([]);setSelected(new Set());setFeedback(null);setAttempts(0);setBgDataUrl(null);setErrorBoxes(0);};

  const Thumb=()=>{
    const ref=useRef(null);
    useEffect(()=>{
      if(!ref.current||!srcCanvasRef.current)return;
      const ctx=ref.current.getContext("2d");
      ref.current.width=44;ref.current.height=44;
      const sc=srcCanvasRef.current;
      ctx.drawImage(sc,sc.width*0.2,sc.height*0.1,sc.width*0.6,sc.height*0.8,0,0,44,44);
    });
    return <canvas ref={ref} width={44} height={44} style={{...deepSunken,display:"block"}}/>;
  };

  return (
    <div style={{minHeight:"100vh",background:"#008080",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'MS Sans Serif',Tahoma,sans-serif",fontSize:11,position:"relative",overflow:"hidden"}}>

      {/* -- Win95 Desktop Icons -- */}
      {[
        { svg:"monitor",  label:"My Existence",       top:18,  left:18 },
        { svg:"trash",    label:"Recycle Bin (Full)", top:110, left:18 },
        { svg:"globe",    label:"The Void",           top:202, left:18 },
        { svg:"folder",   label:"Lost Memories",      top:294, left:18 },
        { svg:"floppy",   label:"Unsaved Self",       top:386, left:18 },
        { svg:"folderOpen",label:"C:\\Who Am I",      top:18,  right:18 },
        { svg:"plug",     label:"Disconnect.exe",     top:110, right:18 },
        { svg:"warning",  label:"Error Log (inf)", top:202, right:18 },
        { svg:"mirror",   label:"Mirror.dll",         top:294, right:18 },
        { svg:"eye",      label:"Watching You",       top:386, right:18 },
        { svg:"tv",           label:"Static Feed",        bottom:80, left:18 },
        { svg:"brain",        label:"Neural Net (empty)", bottom:80, right:18 },
      ].map((d, i) => {
        const svgs = {
          monitor: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              <rect x="2" y="2" width="28" height="20" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="3" y="3" width="26" height="18" fill="#000080"/>
              <rect x="4" y="4" width="24" height="16" fill="#0000aa"/>
              {/* screen glare */}
              <rect x="4" y="4" width="8" height="2" fill="#3333dd" opacity="0.6"/>
              {/* stand */}
              <rect x="12" y="22" width="8" height="3" fill="#a0a0a0" stroke="#000" strokeWidth="1"/>
              <rect x="8" y="25" width="16" height="2" fill="#808080" stroke="#000" strokeWidth="1"/>
              {/* vents */}
              <rect x="4" y="19" width="2" height="1" fill="#808080"/>
              <rect x="7" y="19" width="2" height="1" fill="#808080"/>
              <rect x="10" y="19" width="2" height="1" fill="#808080"/>
            </svg>
          ),
          trash: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              {/* bin body */}
              <rect x="7" y="12" width="18" height="16" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="8" y="13" width="16" height="14" fill="#d4d0c8"/>
              {/* crumpled paper inside */}
              <rect x="10" y="15" width="5" height="4" fill="#fff" stroke="#808080" strokeWidth="1" transform="rotate(-8 12 17)"/>
              <rect x="16" y="16" width="4" height="5" fill="#fff" stroke="#808080" strokeWidth="1" transform="rotate(5 18 18)"/>
              {/* lid */}
              <rect x="6" y="9" width="20" height="3" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <rect x="13" y="7" width="6" height="3" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              {/* lines on body */}
              <rect x="11" y="14" width="1" height="12" fill="#a0a0a0"/>
              <rect x="15" y="14" width="1" height="12" fill="#a0a0a0"/>
              <rect x="19" y="14" width="1" height="12" fill="#a0a0a0"/>
            </svg>
          ),
          globe: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              <circle cx="16" cy="16" r="13" fill="#4488cc" stroke="#000" strokeWidth="1"/>
              {/* land masses */}
              <rect x="10" y="8"  width="8" height="5" fill="#44aa44" rx="1"/>
              <rect x="6"  y="14" width="6" height="6" fill="#44aa44" rx="1"/>
              <rect x="16" y="16" width="7" height="5" fill="#44aa44" rx="1"/>
              <rect x="14" y="22" width="4" height="3" fill="#44aa44" rx="1"/>
              {/* longitude lines */}
              <line x1="16" y1="3"  x2="16" y2="29" stroke="#2266aa" strokeWidth="1"/>
              <line x1="3"  y1="16" x2="29" y2="16" stroke="#2266aa" strokeWidth="1"/>
              <ellipse cx="16" cy="16" rx="6" ry="13" fill="none" stroke="#2266aa" strokeWidth="1"/>
              <circle cx="16" cy="16" r="13" fill="none" stroke="#000" strokeWidth="1"/>
              {/* shine */}
              <ellipse cx="11" cy="10" rx="3" ry="2" fill="#88ccff" opacity="0.4"/>
            </svg>
          ),
          folder: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              <rect x="2"  y="11" width="28" height="18" fill="#ddbb44" stroke="#000" strokeWidth="1"/>
              <rect x="3"  y="12" width="26" height="16" fill="#ffdd66"/>
              {/* tab */}
              <rect x="2"  y="8"  width="10" height="4"  fill="#ddbb44" stroke="#000" strokeWidth="1"/>
              <rect x="3"  y="9"  width="8"  height="2"  fill="#ffdd66"/>
              {/* highlight */}
              <rect x="3" y="12" width="26" height="2" fill="#ffeeaa"/>
              {/* shadow */}
              <rect x="3" y="26" width="26" height="2" fill="#bbaa33"/>
            </svg>
          ),
          floppy: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              <rect x="4"  y="2"  width="24" height="28" fill="#222266" stroke="#000" strokeWidth="1"/>
              {/* label area */}
              <rect x="6"  y="12" width="20" height="14" fill="#ccccdd"/>
              <rect x="7"  y="13" width="18" height="12" fill="#eeeeff"/>
              {/* metal shutter */}
              <rect x="10" y="14" width="8"  height="9"  fill="#888899" stroke="#444" strokeWidth="1"/>
              <rect x="13" y="14" width="2"  height="9"  fill="#aaaaaa"/>
              {/* top label */}
              <rect x="6"  y="3"  width="14" height="8"  fill="#ccccdd"/>
              <rect x="16" y="3"  width="10" height="8"  fill="#111144"/>
              {/* write-protect notch */}
              <rect x="22" y="2"  width="4"  height="4"  fill="#444466"/>
            </svg>
          ),
          folderOpen: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              {/* back */}
              <rect x="2"  y="10" width="14" height="17" fill="#ccaa33" stroke="#000" strokeWidth="1"/>
              {/* open lid */}
              <polygon points="2,10 16,10 26,6 12,6" fill="#ffdd66" stroke="#000" strokeWidth="1"/>
              {/* front */}
              <rect x="4"  y="14" width="26" height="14" fill="#ffdd66" stroke="#000" strokeWidth="1"/>
              <rect x="5"  y="15" width="24" height="12" fill="#ffee88"/>
              {/* tab */}
              <rect x="2"  y="7"  width="10" height="4"  fill="#ddbb44" stroke="#000" strokeWidth="1"/>
              {/* papers sticking out */}
              <rect x="8"  y="10" width="6"  height="5"  fill="#fff" stroke="#aaa" strokeWidth="1" transform="rotate(-6 11 12)"/>
              <rect x="14" y="10" width="6"  height="5"  fill="#fff" stroke="#aaa" strokeWidth="1"/>
            </svg>
          ),
          plug: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              {/* cord */}
              <rect x="14" y="2"  width="4"  height="10" fill="#555"/>
              <rect x="12" y="10" width="8"  height="6"  fill="#888" stroke="#000" strokeWidth="1"/>
              {/* prongs */}
              <rect x="13" y="16" width="2"  height="6"  fill="#666" stroke="#000" strokeWidth="1"/>
              <rect x="17" y="16" width="2"  height="6"  fill="#666" stroke="#000" strokeWidth="1"/>
              {/* face */}
              <ellipse cx="16" cy="12" rx="6" ry="5" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              <circle cx="14" cy="12" r="1" fill="#555"/>
              <circle cx="18" cy="12" r="1" fill="#555"/>
              {/* glow */}
              <rect x="10" y="24" width="12" height="3" fill="#ffff44" opacity="0.6" stroke="#aaaa00" strokeWidth="1"/>
            </svg>
          ),
          warning: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              <polygon points="16,2 30,28 2,28" fill="#ffdd00" stroke="#000" strokeWidth="1"/>
              <polygon points="16,4 28,27 4,27" fill="#ffee44"/>
              {/* ! mark */}
              <rect x="15" y="11" width="2" height="10" fill="#000"/>
              <rect x="15" y="23" width="2" height="2"  fill="#000"/>
              {/* inner shadow */}
              <line x1="4"  y1="27" x2="16" y2="5"  stroke="#ffaa00" strokeWidth="1"/>
            </svg>
          ),
          mirror: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              {/* frame */}
              <rect x="6"  y="2"  width="20" height="24" fill="#c0a060" stroke="#000" strokeWidth="1"/>
              <rect x="8"  y="4"  width="16" height="20" fill="#88aacc"/>
              {/* reflection - faint face outline */}
              <ellipse cx="16" cy="11" rx="5" ry="6" fill="none" stroke="#aaccee" strokeWidth="1" opacity="0.7"/>
              <ellipse cx="14" cy="10" rx="1" ry="1" fill="#aaccee" opacity="0.5"/>
              <ellipse cx="18" cy="10" rx="1" ry="1" fill="#aaccee" opacity="0.5"/>
              <path d="M13 14 Q16 16 19 14" stroke="#aaccee" strokeWidth="1" fill="none" opacity="0.5"/>
              {/* shine streak */}
              <rect x="9"  y="5"  width="2"  height="10" fill="#cce0ff" opacity="0.5"/>
              {/* stand */}
              <rect x="12" y="26" width="8"  height="2"  fill="#c0a060" stroke="#000" strokeWidth="1"/>
              <rect x="10" y="28" width="12" height="2"  fill="#a08040" stroke="#000" strokeWidth="1"/>
            </svg>
          ),
          eye: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              {/* outer eye */}
              <ellipse cx="16" cy="16" rx="13" ry="8" fill="#fff" stroke="#000" strokeWidth="1"/>
              {/* iris */}
              <circle cx="16" cy="16" r="6" fill="#4488cc"/>
              <circle cx="16" cy="16" r="6" fill="none" stroke="#22558a" strokeWidth="1"/>
              {/* pupil */}
              <circle cx="16" cy="16" r="3" fill="#111"/>
              {/* highlight */}
              <circle cx="14" cy="14" r="1" fill="#fff"/>
              <circle cx="18" cy="18" r="1" fill="#ffffff" opacity="0.4"/>
              {/* lashes top */}
              <line x1="8"  y1="11" x2="9"  y2="9"  stroke="#000" strokeWidth="1"/>
              <line x1="12" y1="9"  x2="12" y2="7"  stroke="#000" strokeWidth="1"/>
              <line x1="16" y1="8"  x2="16" y2="6"  stroke="#000" strokeWidth="1"/>
              <line x1="20" y1="9"  x2="20" y2="7"  stroke="#000" strokeWidth="1"/>
              <line x1="24" y1="11" x2="25" y2="9"  stroke="#000" strokeWidth="1"/>
            </svg>
          ),
          tv: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              <rect x="2"  y="4"  width="28" height="20" fill="#c0c0c0" stroke="#000" strokeWidth="1"/>
              {/* screen */}
              <rect x="4"  y="6"  width="22" height="16" fill="#111" stroke="#808080" strokeWidth="1"/>
              {/* static lines */}
              <rect x="4"  y="7"  width="22" height="1"  fill="#444"/>
              <rect x="4"  y="9"  width="22" height="1"  fill="#666"/>
              <rect x="4"  y="11" width="22" height="2"  fill="#fff" opacity="0.08"/>
              <rect x="4"  y="14" width="22" height="1"  fill="#444"/>
              <rect x="4"  y="17" width="22" height="1"  fill="#222"/>
              <rect x="4"  y="19" width="22" height="1"  fill="#555"/>
              {/* antenna */}
              <line x1="10" y1="4"  x2="6"  y2="0"  stroke="#000" strokeWidth="1"/>
              <line x1="18" y1="4"  x2="22" y2="0"  stroke="#000" strokeWidth="1"/>
              {/* controls */}
              <rect x="27" y="8"  width="2"  height="2"  fill="#888" stroke="#000" strokeWidth="1"/>
              <rect x="27" y="12" width="2"  height="2"  fill="#888" stroke="#000" strokeWidth="1"/>
              <rect x="27" y="16" width="2"  height="2"  fill="#ff4444" stroke="#000" strokeWidth="1"/>
              {/* stand */}
              <rect x="10" y="24" width="12" height="3"  fill="#a0a0a0" stroke="#000" strokeWidth="1"/>
              <rect x="8"  y="27" width="16" height="2"  fill="#808080" stroke="#000" strokeWidth="1"/>
            </svg>
          ),
          brain: (
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
              {/* left hemisphere */}
              <ellipse cx="13" cy="15" rx="9" ry="11" fill="#ddaaaa" stroke="#000" strokeWidth="1"/>
              {/* right hemisphere */}
              <ellipse cx="20" cy="15" rx="9" ry="11" fill="#ddaaaa" stroke="#000" strokeWidth="1"/>
              {/* centre divide */}
              <rect x="15" y="5" width="2" height="20" fill="#cc8888"/>
              {/* folds */}
              <path d="M7 10 Q10 8 13 10 Q10 12 7 10" fill="#cc9999" stroke="#aa7777" strokeWidth="1"/>
              <path d="M7 16 Q10 14 13 16 Q10 18 7 16" fill="#cc9999" stroke="#aa7777" strokeWidth="1"/>
              <path d="M19 10 Q22 8 25 10 Q22 12 19 10" fill="#cc9999" stroke="#aa7777" strokeWidth="1"/>
              <path d="M19 16 Q22 14 25 16 Q22 18 19 16" fill="#cc9999" stroke="#aa7777" strokeWidth="1"/>
              {/* stem */}
              <rect x="14" y="26" width="4" height="4" fill="#ddaaaa" stroke="#000" strokeWidth="1"/>
              {/* little circuit lines - "empty" */}
              <rect x="9"  y="22" width="6" height="1" fill="#ff4444" opacity="0.6"/>
              <rect x="17" y="22" width="6" height="1" fill="#ff4444" opacity="0.6"/>
            </svg>
          ),
        };
        return (
        <div key={i} style={{
          position:"fixed",
          top: d.top, bottom: d.bottom,
          left: d.left, right: d.right,
          display:"flex", flexDirection:"column", alignItems:"center",
          gap:3, width:72, cursor:"default",
          userSelect:"none", zIndex:1,
        }}
          onMouseEnter={e => e.currentTarget.querySelector(".lbl").style.background="#000080"}
          onMouseLeave={e => e.currentTarget.querySelector(".lbl").style.background="transparent"}
        >
          <div style={{imageRendering:"pixelated", filter:"drop-shadow(1px 1px 0 rgba(0,0,0,0.5))"}}>{svgs[d.svg]}</div>
          <div className="lbl" style={{
            color:"#fff", fontSize:10, textAlign:"center", lineHeight:1.3,
            padding:"1px 2px", background:"transparent",
            textShadow:"1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
          }}>{d.label}</div>
        </div>
        );
      })}
      <style>{`
        * { box-sizing:border-box }
        @keyframes scanline{0%{top:0}100%{top:100%}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        ::-webkit-scrollbar{width:16px}::-webkit-scrollbar-track{background:#c0c0c0}
        ::-webkit-scrollbar-thumb{background:#c0c0c0;border-top:2px solid #fff;border-left:2px solid #fff;border-right:2px solid #808080;border-bottom:2px solid #808080}
      `}</style>
      <canvas ref={srcCanvasRef} style={{display:"none"}}/>

      <div style={{...raised,background:"#c0c0c0",width:510,boxShadow:"4px 4px 0 #000"}}>
        <TitleBar title="CAPTCHA Verification - GlitchCheck v2.0"/>

        <div style={{borderBottom:"1px solid #808080",padding:"1px 4px",display:"flex",gap:2}}>
          {["File","View","Help"].map(m=>(
            <span key={m} style={{padding:"1px 6px",cursor:"default",fontSize:11}}
              onMouseEnter={e=>{e.target.style.background="#000080";e.target.style.color="#fff";}}
              onMouseLeave={e=>{e.target.style.background="transparent";e.target.style.color="#000";}}>{m}</span>
          ))}
        </div>

        {step==="upload" && <UploadStep fileInputRef={fileInputRef} loadImage={loadImage}/>}

        {step==="captcha" && challenge && (<>
          {/* Prompt */}
          <div style={{padding:"8px 10px 6px",borderBottom:"1px solid #c0c0c0"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:attempts>0?6:0}}>
              <Thumb/>
              <div style={{...deepSunken,background:"#fff",padding:"5px 8px",flex:1,lineHeight:1.6}}>
                <div style={{fontWeight:"bold",fontSize:10}}>Click all fragments containing:</div>
                <div style={{color:"#000080",fontSize:12,fontWeight:"bold",margin:"2px 0"}}>
                  <ChallengeIcon type={challenge.icon}/> {challenge.label}
                </div>
                <div style={{color:"#666",fontSize:9}}>{challenge.desc} . find at least one</div>
              </div>
            </div>
            {attempts>0&&(
              <div style={{...deepSunken,background:"#fff4f0",padding:"2px 8px",display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                <span>(!)</span>
                <span style={{color:"#c00000",fontSize:10}}>Wrong - {attempts} failed attempt{attempts!==1?"s":""}. Collage reshuffled.</span>
              </div>
            )}
          </div>

          {/* Collage */}
          <div style={{padding:"8px 10px 4px"}}>
            <div style={{...deepSunken,position:"relative",width:476,height:408,overflow:"hidden",margin:"0 auto",background:"#08080e"}}>
              {/* Blurred bg from source image */}
              {bgDataUrl&&<div style={{position:"absolute",inset:0,backgroundImage:`url(${bgDataUrl})`,backgroundSize:"cover",backgroundPosition:"center",filter:"blur(16px) brightness(0.2) saturate(2.5)",transform:"scale(1.12)",pointerEvents:"none"}}/>}

              {/* Fragment tiles */}
              {fragments.map(frag=>(
                <FragmentTile key={frag.id} frag={frag} isSelected={selected.has(frag.id)} onToggle={toggleFrag} feedback={feedback}/>
              ))}

              {/* Scanline */}
              <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:1000}}>
                <div style={{position:"absolute",left:0,right:0,height:2,background:"rgba(255,255,255,0.04)",animation:"scanline 5s linear infinite"}}/>
              </div>

              {/* Ghost text labels */}
              {["FACE_MAP.DAT","VISION_CORE","FRAGMENT_ID","RECONSTRUCT","NULL_ZONE","DATASET_ERR","DECODE_FAIL","FACE_LOCK","SCAN_0xF2","MISMATCH"].map((t,i)=>(
                <div key={i} style={{position:"absolute",left:`${4+(i*11.3)%86}%`,top:`${2+(i*13.7)%90}%`,
                  color:"rgba(255,255,255,0.045)",fontSize:8+(i%4)*2,fontFamily:"monospace",
                  transform:`rotate(${(i%2?1:-1)*i*4.5}deg)`,pointerEvents:"none",userSelect:"none",zIndex:1}}>{t}</div>
              ))}

              {/* Success flash only */}
              {feedback==="right"&&(
                <div style={{position:"absolute",inset:0,zIndex:2000,
                  background:"rgba(0,160,0,0.18)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:44,fontFamily:"monospace",fontWeight:"bold",
                  color:"#00ff00",textShadow:"0 0 24px #00ff00",
                  pointerEvents:"none"}}>
                  OK VERIFIED
                </div>
              )}
            </div>
            <div style={{textAlign:"center",fontSize:9,color:"#666",fontFamily:"monospace",marginTop:3}}>
              {selected.size} selected . {fragments.length} total fragments . click to toggle
            </div>
          </div>

          {/* Buttons */}
          <div style={{padding:"4px 10px 10px",display:"flex",justifyContent:"space-between"}}>
            <div style={{display:"flex",gap:6}}>
              <W95Btn onClick={reset}>New Photo</W95Btn>
              <W95Btn onClick={()=>{if(srcCanvasRef.current)buildChallenge(srcCanvasRef.current);}}><svg width="11" height="11" viewBox="0 0 11 11" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{display:"inline",verticalAlign:"middle"}}><path d="M9 5.5 A3.5 3.5 0 1 1 7 2.2" fill="none" stroke="#000" strokeWidth="1.5"/><polygon points="7,0 10,3 7,3" fill="#000"/></svg> Reshuffle</W95Btn>
            </div>
            <W95Btn onClick={verify} disabled={selected.size===0||!!feedback}>Verify</W95Btn>
          </div>
        </>)}

        {step==="success"&&(
          <div style={{padding:24}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:16}}>
              <svg width="40" height="40" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{flexShrink:0}}>
                <polygon points="16,2 28,7 28,20 16,30 4,20 4,7" fill="#44aa44" stroke="#000" strokeWidth="1"/>
                <polygon points="16,4 26,8 26,19 16,28 6,19 6,8" fill="#55cc55"/>
                <polygon points="16,4 26,8 24,8 16,5 8,8 6,8" fill="#88ee88" opacity="0.6"/>
                <polyline points="9,16 14,21 23,11" fill="none" stroke="#fff" strokeWidth="3"/>
                <line x1="8" y1="10" x2="10" y2="16" stroke="#aaffaa" strokeWidth="1" opacity="0.5"/>
              </svg>
              <div>
                <div style={{fontWeight:"bold",fontSize:13,marginBottom:5}}>{successMsg.title}</div>
                <div style={{lineHeight:1.85,color:"#222",fontSize:11}}>
                  {successMsg.line1}<br/>
                  <span style={{color:"#005500",fontWeight:"bold"}}>{successMsg.line2}</span>
                </div>
                {attempts>0&&<div style={{color:"#888",fontSize:10,marginTop:4}}>{attempts+1} attempt{attempts!==1?"s":""} to recognise yourself.</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <W95Btn onClick={()=>setStep("desktop")} style={{background:"#000080",color:"#fff",fontWeight:"bold"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                  <svg width="14" height="14" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
                    {/* Win95 monitor icon - Enter Desktop */}
                    <rect x="2" y="3" width="24" height="17" fill="#c0c0c0" stroke="#fff" strokeWidth="1"/>
                    <rect x="3" y="4" width="22" height="15" fill="#000080"/>
                    <rect x="4" y="5" width="7" height="2" fill="#3333dd" opacity="0.6"/>
                    <rect x="11" y="17" width="7" height="3" fill="#a0a0a0" stroke="#fff" strokeWidth="1"/>
                    <rect x="8"  y="20" width="13" height="2" fill="#808080" stroke="#fff" strokeWidth="1"/>
                    {/* arrow pointing right into screen */}
                    <polygon points="18,9 26,12 18,15" fill="#ffff44" stroke="#aaaa00" strokeWidth="1"/>
                    <rect x="14" y="11" width="4" height="2" fill="#ffff44" stroke="#aaaa00" strokeWidth="1"/>
                  </svg>
                  Continue to Desktop
                </span>
              </W95Btn>
              <W95Btn onClick={reset}>Start Over</W95Btn>
            </div>
          </div>
        )}

        {step==="desktop"&&null}

        {/* Status bar */}
        <div style={{borderTop:"1px solid #808080",display:"flex",gap:1,padding:"1px 2px"}}>
          {[
            step==="upload"?"Waiting for image...":step==="captcha"?`${fragments.filter(f=>f.isCorrect).length} correct . ${fragments.length} total`:"Verified OK",
            `Attempt ${attempts+1}`,
            timeStr,
          ].map((t,i)=>(
            <div key={i} style={{...sunken,padding:"1px 6px",flex:i===0?1:"none",fontSize:10,whiteSpace:"nowrap"}}>{t}</div>
          ))}
        </div>
      </div>

      {step==="desktop"&&<Win95Desktop onBack={reset} attempts={attempts} photoUrl={bgDataUrl}/>}

      {/* Cascading error dialogs on wrong answer */}
      {errorBoxes>0 && <ErrorDialogs count={errorBoxes} onDone={handleErrorsDone}/>}

      {/* Taskbar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#c0c0c0",borderTop:"2px solid #fff",height:30,display:"flex",alignItems:"center",padding:"0 2px",gap:4}}>
        <button style={{...raised,background:"#c0c0c0",display:"flex",alignItems:"center",gap:4,padding:"2px 8px",fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,fontWeight:"bold",cursor:"pointer",height:22}}>
          <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges"><rect x="1" y="1" width="5" height="5" fill="#ff0000"/><rect x="7" y="1" width="5" height="5" fill="#00aa00"/><rect x="1" y="7" width="5" height="5" fill="#0000ff"/><rect x="7" y="7" width="5" height="5" fill="#ffaa00"/></svg> Start
        </button>
        <div style={{width:1,background:"#808080",height:20,margin:"0 2px"}}/>
        <button style={{...sunken,background:"#c0c0c0",padding:"2px 8px",fontFamily:"'MS Sans Serif',sans-serif",fontSize:11,cursor:"pointer",height:22,display:"flex",alignItems:"center",gap:4}}>
          <svg width="12" height="13" viewBox="0 0 10 11" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges"><rect x="2" y="5" width="6" height="5" fill="#c0a020" stroke="#806000" strokeWidth="1"/><path d="M3 5 L3 3 Q5 1 7 3 L7 5" fill="none" stroke="#806000" strokeWidth="1.5"/><rect x="4" y="7" width="2" height="2" fill="#806000"/></svg> GlitchCheck CAPTCHA v2
        </button>
        <div style={{marginLeft:"auto",...sunken,padding:"2px 8px",fontSize:11}}>{timeStr}</div>
      </div>
    </div>
  );
}
