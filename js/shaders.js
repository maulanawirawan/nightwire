// nightwire: all GLSL. Linear HDR lighting, ACES + sRGB at the end.
(() => {
const NW = window.NW = window.NW || {};

const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 uVP; uniform vec3 uCam; uniform float uT, uRain, uWet, uLow;
uniform vec3 uPal[6];
uniform float uAlertId, uAlertAge;
float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnz(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h1(i),h1(i+vec2(1.,0.)),f.x),mix(h1(i+vec2(0.,1.)),h1(i+1.),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vnz(p);p=p*2.03+17.1;a*=.5;}return s;}
vec3 skyEnv(vec3 d){
  float y=d.y;
  vec3 c=mix(vec3(.075,.046,.05),vec3(.005,.005,.011),pow(clamp(y,0.,1.),.38));
  if(y<0.) c=mix(vec3(.06,.04,.04),vec3(.012,.01,.012),clamp(-y*4.,0.,1.));
  return c;
}
vec3 envRefl(vec3 R){
  vec3 e=skyEnv(R);
  float lo=smoothstep(.2,-.05,R.y);
  vec2 q=vec2(atan(R.z,R.x)*80.,R.y*110.);
  float s=step(.84,h1(floor(q)));
  return mix(e,vec3(.02,.017,.02),lo*.7)+vec3(1.,.72,.48)*s*lo*.18;
}
vec3 fogCol(vec3 d){return vec3(.032,.026,.034)+vec3(.05,.028,.016)*exp(-max(d.y,0.)*5.);}
vec3 applyFog(vec3 col,vec3 p){
  vec3 v=p-uCam; float dist=length(v); vec3 d=v/max(dist,1e-4);
  float a=.0055*(1.+uRain*.5), b=.016;
  float k=d.y*b;
  float fh=abs(k)<1e-4 ? a*exp(-uCam.y*b)*dist : a*exp(-uCam.y*b)*(1.-exp(-dist*k))/k;
  return mix(col,fogCol(d),clamp(1.-exp(-fh-dist*.00022*(1.+uRain*.4)),0.,1.));
}
// street lamps sit on a regular grid: every street, both sides, every 30 m (staggered), none in intersections
vec3 lampTint(float c,float ax){
  float k=floor(c/100.+5.5);
  bool sodium = ax<.5 ? mod(k,3.)==1. : mod(k,4.)==2.;
  return sodium ? vec3(1.,.55,.2)*1.15 : vec3(1.,.88,.74);
}
float lampOne(vec3 p,vec3 n,vec3 L){
  vec3 v=L-p; float d2=dot(v,v); vec3 l=v*inversesqrt(d2);
  return max(dot(n,l),0.)*pow(clamp(l.y,0.,1.),.7)*58./(d2+1.);
}
vec3 lamps(vec3 p,vec3 n){
  if(abs(p.x)>505.||abs(p.z)>505.) return vec3(0.);
  float cx=100.*floor(p.x/100.+.5), cz=100.*floor(p.z/100.+.5);
  vec3 s=vec3(0.);
  for(int k=0;k<2;k++){
    float sd=k==0?-1.:1., of=k==0?0.:15.;
    float lz=30.*floor((p.z-of)/30.+.5)+of;
    float mz=step(11.,abs(lz-100.*floor(lz/100.+.5)));
    s+=lampOne(p,n,vec3(cx+sd*5.6,7.6,lz))*mz*lampTint(cx,0.);
    float lx=30.*floor((p.x-of)/30.+.5)+of;
    float mx=step(11.,abs(lx-100.*floor(lx/100.+.5)));
    s+=lampOne(p,n,vec3(lx,7.6,cz+sd*5.6))*mx*lampTint(cz,1.);
  }
  return s;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
`;

const TRI = `out vec2 vUv; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;

const SKY = [TRI, `
in vec2 vUv; uniform mat4 uInv; out vec4 o;
void main(){
  vec4 a=uInv*vec4(vUv*2.-1.,1.,1.); vec3 d=normalize(a.xyz/a.w-uCam);
  vec3 col=skyEnv(d);
  if(d.y>0.){
    float t=(750.-uCam.y)/max(d.y,.025);
    vec2 w=uCam.xz+d.xz*t;
    float cl=smoothstep(.32,.85,fbm(w*.0011+vec2(uT*.0025,uT*.0012)));
    float glow=exp(-length(w)*.0008);
    vec3 cc=mix(vec3(.045,.028,.034),vec3(.2,.1,.07),glow)*(.35+cl*.95);
    col=mix(col,cc,cl*smoothstep(0.,.12,d.y)*.9);
    vec2 sp=vec2(atan(d.z,d.x)*120.,d.y*170.); float hh=h1(floor(sp));
    col+=vec3(.7,.8,1.)*step(.988,hh)*smoothstep(.12,0.,length(fract(sp)-.5))*(1.-cl)*smoothstep(.1,.4,d.y)*.6;
    vec3 md=normalize(vec3(.35,.38,-.86)); float mm=max(dot(d,md),0.);
    col+=vec3(.5,.55,.7)*(pow(mm,900.)*3.+pow(mm,30.)*.06)*(1.-cl*.85);
  }
  col=mix(col,fogCol(d),exp(-max(d.y,0.)*14.)*.85);
  o=vec4(col,1.);
}`];

// ---------- buildings, lamp hardware, rooftop plant: one instanced box shader ----------
const BLD = [`
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec2 aUV;
layout(location=3) in vec4 iA; layout(location=4) in vec4 iB; layout(location=5) in vec4 iC;
uniform sampler2D uProof;
out vec3 vW; out vec3 vN; out vec2 vUV;
flat out vec3 vSize; flat out vec4 vA; flat out vec4 vBm; flat out vec4 vC; flat out float vProof;
void main(){
  vec3 size=iB.xyz; vec3 w=iA.xyz+vec3(aPos.x*size.x,aPos.y*size.y,aPos.z*size.z);
  vW=w; vN=aNor; vUV=aUV; vSize=size; vA=iA; vBm=iB; vC=iC;
  int id=int(iA.w+.5);
  vProof=iA.w>-.5 ? texelFetch(uProof,ivec2(id%1024,id/1024),0).r : -1.;
  gl_Position=uVP*vec4(w,1.);
}`, `
in vec3 vW; in vec3 vN; in vec2 vUV;
flat in vec3 vSize; flat in vec4 vA; flat in vec4 vBm; flat in vec4 vC; flat in float vProof;
out vec4 o;
vec3 interior(vec2 f,vec2 cid,vec3 V,vec3 n,vec3 T,vec2 csz,float depth,float seed,float litP,float bright){
  float r1=h1(cid+seed*17.31), r2=h1(cid.yx*1.7+seed*3.1), r3=h1(cid*2.3+seed*7.7);
  float lit=step(1.-litP,r1);
  lit=abs(lit-step(.996,h1(cid*1.3+floor(uT*.08+r2*9.))));
  vec3 lc=r2<.45?vec3(1.,.6,.3):r2<.85?vec3(1.,.83,.62):vec3(.72,.84,1.);
  float tv=step(.94,r3);
  lc=mix(lc,vec3(.3,.42,1.)*(.5+.5*sin(uT*7.+r1*40.)*sin(uT*2.3+r2*20.)),tv);
  if(uLow>.5) return lc*lit*bright*.45;
  vec3 dir=vec3(dot(V,T)/csz.x,V.y/csz.y,dot(V,-n)/depth);
  vec3 pos=vec3(f*2.-1.,-1.);
  vec3 id=1./dir; vec3 k=abs(id)-pos*id; float km=min(min(k.x,k.y),k.z); vec3 hp=pos+km*dir;
  float dz=hp.z*.5+.5;
  vec3 c;
  if(km==k.z){
    c=vec3(.5,.46,.42)*(.7+.5*h1(cid+9.));
    float fx=h1(cid+4.)*1.2-.6;
    if(hp.y<-.42&&abs(hp.x-fx)<.38) c*=.18;
    if(hp.y>-.1&&hp.y<.45&&abs(hp.x+fx*.6)<.2) c=mix(c,vec3(.95,.85,.6),.5*step(.6,r3));
  } else if(km==k.y){
    c=hp.y>0.?vec3(1.)*(1.3-length(hp.xz)*.5):vec3(.2,.16,.13);
  } else c=vec3(.42,.4,.37)*(.5+.5*dz);
  c*=lc*(.5+.5*dz);
  vec3 res=c*lit*bright+c*.003;
  float bl=step(.68,fract(r2*7.));
  float cover=step(1.-fract(r3*5.)*.85,f.y)*bl;
  return mix(res,lc*lit*bright*.32*(.6+.4*step(.5,fract(f.y*16.)))+.002,cover);
}
void main(){
  vec3 n=normalize(vN);
  float mat=vBm.w, seed=vC.x, bay=vC.y, shop=vC.z;
  vec3 V=normalize(vW-uCam);
  bool top=n.y>.5, bottom=n.y<-.5;
  vec2 fd=top||bottom?vSize.xz:(abs(n.x)>.5?vSize.zy:vSize.xy);
  vec2 lp=vUV*fd;
  vec3 T=(top||bottom)?vec3(1.,0.,0.):(abs(n.x)>.5?vec3(0.,0.,-n.x):vec3(n.z,0.,0.));
  float u=lp.x, y=vW.y, ly=y-vA.y;
  float cosT=clamp(dot(-V,n),0.,1.), F=.04+.96*pow(1.-cosT,5.);
  vec3 R=reflect(V,n);
  vec3 L=lamps(vW,n);
  vec3 amb=skyEnv(n)*.45+vec3(.035,.025,.02)*exp(-y*.04)*(1.-max(n.y,0.));
  vec3 col=vec3(0.), em=vec3(0.);
  if(mat>5.5){                                   // street hardware
    vec3 metal=vec3(.03,.032,.035);
    col=metal*(amb+L)+envRefl(R)*(F*.5+.03);
    if(mat>6.5&&mat<7.5&&bottom) em=(vBm.w>6.5?vec3(1.,.88,.74):vec3(0.))*28.;
    if(mat>7.5){ col=vec3(.25,.25,.24)*(amb+L); if(abs(n.y)<.5&&length(lp-fd*.5)<.22) col*=.2; }
  } else if(mat>2.5&&mat<4.5){                   // rooftop plant, antennas
    col=vec3(.07,.07,.075)*(.7+.5*step(.5,fract(u*3.)))*(amb+L)+envRefl(R)*F*.2;
    if(mat>3.5&&ly>vSize.y-.6) em=vec3(1.,.04,.04)*40.*step(.35,sin(uT*2.2+seed*40.));
  } else if(top){                                // roofs
    col=vec3(.045,.045,.05)*(.55+.9*vnz(lp*1.7))*(amb+L)+envRefl(R)*(F*.7+.02)*uWet*.5;
    float e=min(min(lp.x,fd.x-lp.x),min(lp.y,fd.y-lp.y));
    col=mix(col,vec3(.1)*(amb+L)+envRefl(R)*.05,1.-smoothstep(.3,.4,e));
  } else {
    bool storefront=shop>.5&&ly<4.6&&vA.y<.5;
    if(storefront){                              // ground-floor shops
      float sb=2.8, cx=u/sb; vec2 cid=vec2(floor(cx),0.); float fx=fract(cx);
      float r=h1(cid+seed*31.);
      float frame=1.-step(.04,fx)*step(fx,.96)*step(.35,ly)*step(ly,3.7);
      float shut=step(.72,r);
      vec3 inner=interior(vec2(fx,clamp((ly-.35)/3.35,0.,1.)),cid+77.,V,n,T,vec2(sb,3.4),6.,seed+3.,1.,3.2);
      inner*=mix(vec3(1.),vec3(1.,.9,.8)*(.6+.8*vnz(vec2(u*2.,ly*3.))),.6);
      vec3 glass=inner*(1.-F)+envRefl(R)*(F*.9+.03);
      vec3 shutter=vec3(.1)*(.8+.2*sin(ly*90.))*(amb+L)+envRefl(R)*F*.3;
      vec3 fasc=vec3(.03,.03,.034)*(amb+L);
      col=mix(mix(glass,shutter,shut),fasc,frame);
      if(ly>3.7) col=fasc;
    } else if(mat<.5||(mat>4.5&&mat<5.5)){      // glass curtain wall
      float fh=3.6; vec2 g=vec2(u/bay,y/fh); vec2 cid=floor(g); vec2 f=fract(g);
      float frame=1.-step(.025,f.x)*step(f.x,.975)*step(.05,f.y)*step(f.y,.82);
      float litP=mat>4.5?.55:.42-.2*fract(seed*5.);
      vec3 rc=interior(vec2(f.x,f.y/.82),cid,V,n,T,vec2(bay,fh*.82),4.5,seed,litP,mat>4.5?1.6:2.);
      vec3 glass=rc*vec3(.72,.82,.86)*(1.-F)+envRefl(R)*(F*.95+.05);
      vec3 metal=vec3(.035,.04,.045)*(amb+L)+envRefl(R)*(F*.3+.04);
      col=mix(glass,metal,frame);
      if(mat>4.5){ float band=step(fract(y/30.-uT*.05),.03); em+=uPal[0]*band*6.; }
    } else {                                    // concrete or brick with punched windows
      bool brick=mat>1.5;
      float fh=brick?3.3:3.4; vec2 g=vec2(u/bay,y/fh); vec2 cid=floor(g); vec2 f=fract(g);
      float wx=brick?.3:.2, wy=brick?.2:.24;
      float win=step(wx,f.x)*step(f.x,1.-wx)*step(wy,f.y)*step(f.y,.8);
      vec3 alb;
      if(brick){
        float bh=.075, row=floor(y/bh), off=mod(row,2.)*.5;
        float bx=fract(u/.24+off), by=fract(y/bh);
        float mort=max(step(bx,.06),step(by,.14));
        alb=mix(vec3(.2,.075,.045)*(.65+.7*h1(vec2(floor(u/.24+off),row)+seed)),vec3(.12,.11,.1),mort);
      } else {
        alb=mix(vec3(.17,.165,.155),vec3(.09,.1,.115),fract(seed*3.7))*(.7+.5*vnz(vec2(u*.7,y*.12)+seed*10.))*(.85+.3*vnz(vec2(u*5.,y*.35)));
      }
      alb*=mix(1.,.62,uWet*smoothstep(30.,0.,y));
      vec3 wall=alb*(amb+L)+envRefl(R)*F*.12*uWet;
      vec3 rc=interior(vec2((f.x-wx)/(1.-2.*wx),(f.y-wy)/(.8-wy)),cid,V,n,T,vec2(bay*(1.-2.*wx),fh*(.8-wy)),4.,seed,brick?.55:.45,1.8);
      vec3 w=rc*vec3(.82,.86,.9)*(1.-F)+envRefl(R)*(F*.8+.03);
      float fr=win*(1.-step(wx+.03,f.x)*step(f.x,1.-wx-.03)*step(wy+.03,f.y)*step(f.y,.77));
      col=mix(wall,w,win);
      col=mix(col,vec3(.02)*(amb+L),fr);
      col*=1.-.35*step(.8,f.y)*step(f.y,.84)*step(wx,f.x)*step(f.x,1.-wx);
    }
    col*=mix(.4,1.,smoothstep(0.,2.5,ly+vA.y));
  }
  // AR overlay: proof outline and scan sweep, intrusion alert
  if(vA.w>-.5&&mat<5.5&&!(mat>2.5&&mat<4.5)){
    vec2 e2=min(lp,fd-lp); float e=min(e2.x,e2.y); float fw=fwidth(e);
    float edge=1.-smoothstep(0.,fw*1.5+.08,e);
    if(vProof>0.){
      float age=uT-vProof, sc=smoothstep(0.,1.2,age);
      em+=uPal[0]*(edge*4.*sc+exp(-abs(ly/max(vSize.y,1.)-age/1.2)*24.)*step(age,1.35)*3.);
    }
    if(abs(vA.w-uAlertId)<.5&&uAlertAge>1.2&&uAlertAge<4.8){
      em+=uPal[5]*(edge*6.*(.55+.45*step(.5,fract(uAlertAge*3.)))+.04);
    }
  }
  o=vec4(applyFog(col+em,vW),1.);
}`];

// ---------- cars ----------
const CAR = [`
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in float aPart;
layout(location=3) in vec4 iA; layout(location=4) in vec4 iB;
uniform vec4 uLead;
out vec3 vW; out vec3 vN; out vec3 vL; flat out float vPart; flat out vec4 vI;
void main(){
  vec3 q=aPos, W, N; float s=iA.z;
  float along=iB.z>.5?iB.x:mod(iB.x+uT*iA.w,1000.)-500.;
  if(iB.z>1.5){ W=vec3(uLead.x+q.x,q.y,uLead.y+q.z); N=aNor; }
  else if(iA.y<.5){ W=vec3(iA.x+q.x*s,q.y,along*s+q.z*s); N=vec3(aNor.x*s,aNor.y,aNor.z*s); }
  else { W=vec3(along*s+q.z*s,q.y,iA.x-q.x*s); N=vec3(aNor.z*s,aNor.y,-aNor.x*s); }
  bool hide=(iB.z>1.5&&uLead.z<.5)||(iB.z<1.5&&(abs(along)>497.||abs(iA.x)>505.));
  if(hide) W.y-=2000.;
  vW=W; vN=N; vL=q; vPart=aPart; vI=vec4(iB.y,iB.z,0.,0.);
  gl_Position=uVP*vec4(W,1.);
}`, `
in vec3 vW; in vec3 vN; in vec3 vL; flat in float vPart; flat in vec4 vI; out vec4 o;
void main(){
  vec3 n=normalize(vN), V=normalize(vW-uCam);
  float r=vI.x; bool parked=vI.y>.5&&vI.y<1.5;
  vec3 paint=r<.28?vec3(.008):r<.48?vec3(.42,.43,.45):r<.58?vec3(.3,.012,.015):r<.68?vec3(.55,.38,.02):r<.82?vec3(.015,.03,.08):vec3(.13,.13,.14);
  vec3 L=lamps(vW,n), amb=skyEnv(n)*.4;
  float cosT=clamp(dot(-V,n),0.,1.), F=.04+.96*pow(1.-cosT,5.);
  vec3 env=envRefl(reflect(V,n));
  vec3 col, em=vec3(0.);
  if(vPart<.5){
    col=paint*(amb+L)+env*(F*.85+.05);
    if(vL.z>2.18&&vL.y>.55&&vL.y<.78&&abs(vL.x)>.42&&abs(vL.x)<.84) em=parked?vec3(.02):vec3(1.,.93,.82)*22.;
    if(vL.z<-2.18&&vL.y>.62&&vL.y<.86&&abs(vL.x)>.5) em=vec3(1.,.02,.03)*(parked?.3:7.);
  } else if(vPart<1.5){
    col=vec3(.004)+env*(F*.9+.1);
  } else col=vec3(.006)*(amb+L);
  o=vec4(applyFog(col+em,vW),1.);
}`];

// light thrown on the road by moving cars
const POOL = [`
layout(location=3) in vec4 iA; layout(location=4) in vec4 iB;
uniform vec4 uLead;
out vec2 vQ; flat out float vTail; out vec3 vW;
void main(){
  int id=gl_VertexID%6; int quad=gl_VertexID/6;
  vec2 c=vec2(id==1||id==2||id==4?1.:0., id==2||id==4||id==5?1.:0.);
  float tail=float(quad);
  float z=tail>.5?mix(-2.3,-6.,c.y):mix(2.3,20.,c.y);
  float w=tail>.5?1.1:mix(1.,4.2,c.y);
  vec3 q=vec3((c.x*2.-1.)*w,.04,z);
  float s=iA.z, along=mod(iB.x+uT*iA.w,1000.)-500.;
  vec3 W;
  if(iB.z>1.5) W=vec3(uLead.x+q.x,q.y,uLead.y+q.z);
  else if(iA.y<.5) W=vec3(iA.x+q.x*s,q.y,along*s+q.z*s);
  else W=vec3(along*s+q.z*s,q.y,iA.x-q.x*s);
  bool hide=(iB.z>.5&&iB.z<1.5)||(iB.z>1.5&&uLead.z<.5)||(iB.z<.5&&abs(along)>497.);
  if(hide) W.y-=2000.;
  vQ=vec2(c.x*2.-1.,c.y); vTail=tail; vW=W;
  gl_Position=uVP*vec4(W,1.);
}`, `
in vec2 vQ; flat in float vTail; in vec3 vW; out vec4 o;
void main(){
  float side=1.-vQ.x*vQ.x;
  vec3 c=vTail>.5?vec3(1.,.03,.03)*.12*(1.-vQ.y)*side:vec3(1.,.9,.78)*.55*pow(1.-vQ.y,1.6)*side*smoothstep(0.,.08,vQ.y);
  float d=length(vW-uCam);
  o=vec4(c*exp(-d*.006),1.);
}`];

// ---------- neon signs (text from a canvas atlas: R = tube core, G = glow) ----------
const SIGN = [`
layout(location=0) in vec4 iP; layout(location=1) in vec4 iQ; layout(location=2) in vec4 iU; layout(location=3) in vec4 iS;
out vec2 vUv; out vec2 vQ; out vec3 vW; flat out vec4 vS; flat out vec3 vCol; flat out vec2 vSz;
void main(){
  vec2 c=vec2(gl_VertexID&1,gl_VertexID>>1);
  vec3 R=vec3(iQ.x,0.,iQ.y);
  vec3 W=iP.xyz+R*(c.x-.5)*iP.w+vec3(0.,(c.y-.5)*iQ.z,0.);
  vUv=vec2(mix(iU.x,iU.z,c.x),mix(iU.w,iU.y,c.y)); vQ=c; vW=W; vS=iS; vCol=uPal[int(iQ.w+.5)]; vSz=vec2(iP.w,iQ.z);
  gl_Position=uVP*vec4(W,1.);
}`, `
uniform sampler2D uAtlas;
in vec2 vUv; in vec2 vQ; in vec3 vW; flat in vec4 vS; flat in vec3 vCol; flat in vec2 vSz; out vec4 o;
void main(){
  vec2 uv=vUv;
  vec4 iU=vec4(0.);
  float blade=vS.y;
  vec2 q=vQ;
  if(!gl_FrontFacing){ q.x=1.-q.x; }
  // remap u inside the atlas rect after the flip
  vec2 a=texture(uAtlas,uv).rg;
  if(!gl_FrontFacing){ a=texture(uAtlas,vec2(vS.z+(vS.w-vS.z)*q.x,uv.y)).rg; }
  float fl=vS.x;
  float flick=1.;
  if(fl>.9) flick=step(.25,fract(sin(floor(uT*9.+fl*50.)*12.9898)*43758.5));
  else if(fl>.82) flick=.55+.45*step(.1,fract(uT*.37+fl*7.));
  vec3 em=vCol*(a.r*9.+a.g*1.6)*flick+vec3(1.)*a.r*flick*1.2;
  vec3 col=em;
  if(blade>.5){
    vec2 pm=q*vSz; vec2 e2=min(pm,vSz-pm); float e=min(e2.x,e2.y);
    vec3 n=vec3(0.,1.,0.);
    vec3 panel=vec3(.012,.012,.015)*(lamps(vW,normalize(cross(vec3(0.,1.,0.),vec3(1.,0.,0.))))+.2);
    col=panel+em+vCol*(1.-smoothstep(.04,.08,e))*5.*flick;
  } else {
    if(a.g<.02) discard;
  }
  o=vec4(applyFog(col,vW),1.);
}`];

// ---------- volumetric-looking light cones under the lamps ----------
const CONE = [`
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=3) in vec4 iL;
out vec3 vN; out vec3 vW; out float vT; flat out vec3 vTint;
void main(){
  vec3 W=iL.xyz+vec3(aPos.x,aPos.y*7.55,aPos.z);
  vN=aNor; vW=W; vT=-aPos.y; vTint=iL.w>.5?vec3(1.,.55,.2):vec3(1.,.88,.74);
  gl_Position=uVP*vec4(W,1.);
}`, `
in vec3 vN; in vec3 vW; in float vT; flat in vec3 vTint; out vec4 o;
void main(){
  vec3 V=normalize(vW-uCam);
  float f=pow(abs(dot(normalize(vN),V)),1.4)*pow(1.-vT,1.3)*smoothstep(0.,.08,vT);
  float d=length(vW-uCam);
  o=vec4(vTint*f*.07*(1.+uRain*1.2)*exp(-d*.006)*smoothstep(1.,6.,d),1.);
}`];

// ---------- ground: asphalt, markings, sidewalks, puddles, rain ripples, mirror reflections ----------
const GROUND = [`
layout(location=0) in vec2 aP; out vec3 vW;
void main(){vW=vec3(aP.x,0.,aP.y);gl_Position=uVP*vec4(vW,1.);}`, `
in vec3 vW; uniform sampler2D uRefl; uniform vec2 uRes; out vec4 o;
vec2 ripple(vec2 p){
  vec2 q=p*1.6, c=floor(q), f=fract(q)-.5;
  float h=h1(c); vec2 off=(vec2(h1(c+3.1),h1(c+7.7))-.5)*.4;
  float ph=fract(uT*1.3+h);
  vec2 d=f-off; float r=length(d), x=r-ph*.45;
  return d/(r+1e-3)*sin(x*55.)*exp(-x*x*80.)*(1.-ph);
}
float line(float a,float c,float w){return 1.-smoothstep(w,w+.03,abs(a-c));}
void main(){
  vec2 p=vW.xz; float dist=length(vW-uCam);
  float cx=100.*floor(p.x/100.+.5), cz=100.*floor(p.y/100.+.5);
  float dx=abs(p.x-cx), dz=abs(p.y-cz);
  bool city=abs(p.x)<505.&&abs(p.y)<505.;
  float n1=vnz(p*5.), n2=vnz(p*.8), n3=vnz(p*.09+7.);
  vec3 alb; float rough;
  bool road=city&&(dx<7.||dz<7.);
  bool walk=city&&!road&&(dx<10.||dz<10.);
  if(road){
    alb=vec3(.026,.026,.029)*(.7+.6*n1)*(.85+.3*n2); rough=.42+.2*n1;
    vec3 yel=vec3(.42,.3,.04), wht=vec3(.48);
    if(dx<7.&&dz>=10.){
      alb=mix(alb,yel,line(dx,.18,.06)*.85);
      alb=mix(alb,wht,line(dx,3.5,.06)*step(.5,fract(p.y/9.))*.8);
      alb=mix(alb,wht,line(dx,6.6,.07)*.7);
      alb=mix(alb,wht,step(11.,dz)*step(dz,14.)*step(.5,fract(p.x/1.1))*step(dx,6.4)*.8);
    } else if(dz<7.&&dx>=10.){
      alb=mix(alb,yel,line(dz,.18,.06)*.85);
      alb=mix(alb,wht,line(dz,3.5,.06)*step(.5,fract(p.x/9.))*.8);
      alb=mix(alb,wht,line(dz,6.6,.07)*.7);
      alb=mix(alb,wht,step(11.,dx)*step(dx,14.)*step(.5,fract(p.y/1.1))*step(dz,6.4)*.8);
    } else {
      vec2 mh=fract(p/23.)-.5; alb=mix(alb,vec3(.05),step(length(mh*23.),.35)*.8);
    }
  } else if(walk){
    vec2 t=abs(fract(p/1.2)-.5);
    alb=vec3(.07,.068,.064)*(.75+.5*n1)*(.82+.18*smoothstep(.46,.48,.5-max(t.x,t.y)));
    rough=.5;
    float e=min(dx,dz);
    if(e<7.3) { alb=vec3(.11,.105,.1); rough=.6; }
  } else if(city){ alb=vec3(.025); rough=.6; }
  else { alb=vec3(.016,.016,.018)*(.8+.4*n2); rough=.55; }
  float pud=smoothstep(.55,.63,n3+n1*.06)*(road?1.:.6)*uWet;
  alb*=mix(1.,.45,uWet);
  rough=mix(rough,mix(rough*.55,.015,pud),uWet);
  // light: lamps, storefront spill on the sidewalks, contact shadow at the walls
  vec3 L=lamps(vW,vec3(0.,1.,0.));
  vec3 spill=vec3(0.);
  float ao=1.;
  if(city){
    float e=min(dx,dz);
    if(e<10.){
      float along=dx<dz?p.y:p.x; float st=dx<dz?cx:cz;
      float side=dx<dz?sign(p.x-cx):sign(p.y-cz);
      float seg=floor(along/14.); float hs=h1(vec2(seg,st+side*3.));
      vec3 sc=hs<.45?vec3(1.,.62,.32):vec3(.75,.85,1.);
      spill=sc*step(.3,hs)*1.1*exp(-(10.-e)*.45)*(.6+.4*sin(fract(along/14.)*3.14159));
      ao=mix(.35,1.,smoothstep(0.,.7,10.-e));
    } else ao=.5;
  }
  vec3 col=alb*(vec3(.012,.01,.012)+L+spill)*ao;
  vec3 V=normalize(vW-uCam);
  float F=.02+.98*pow(1.-max(-V.y,0.),5.);
  vec2 rp=ripple(p)*pud*exp(-dist*.05)*uRain;
  vec2 suv=gl_FragCoord.xy/uRes+rp*.03+(vec2(n1,n2)-.5)*.003;
  float lod=rough*7.;
  vec3 refl=vec3(0.);
  for(int k=-2;k<=2;k++) refl+=textureLod(uRefl,suv+vec2(0.,float(k)*.014*rough),lod).rgb;
  refl*=.2;
  col+=refl*F*mix(.12,1.,uWet)*(1.-rough*.75)*1.5*ao;
  col+=vec3(.5,.6,.8)*length(rp)*.06;
  o=vec4(applyFog(col,vW),1.);
}`];

const RAIN = [`
out float vA;
void main(){
  float id=float(gl_InstanceID);
  vec3 r=vec3(h1(vec2(id,1.3)),h1(vec2(id,2.7)),h1(vec2(id,4.1)));
  vec3 box=vec3(40.,26.,40.);
  vec3 vel=vec3(1.2,-10.5,.5)*(.85+.3*r.x);
  vec3 p=mod(r*box+vel*uT-uCam+box*.5,box)-box*.5+uCam;
  if(gl_VertexID==1) p-=vel*.045;
  float d=length(p-uCam);
  vA=uRain*.16*smoothstep(22.,2.,d)*smoothstep(.4,1.6,d)*step(0.,p.y)*clamp(1.2-uCam.y/120.,.25,1.);
  gl_Position=uVP*vec4(p,1.);
}`, `in float vA; out vec4 o; void main(){o=vec4(vec3(.6,.68,.85)*vA,1.);}`];

const BEAM = [`
layout(location=0) in vec4 iBm; out float vS; out float vV; out float vAge; out float vF;
void main(){
  float side=float(gl_VertexID&1)*2.-1., v=float(gl_VertexID>>1);
  vec3 base=iBm.xyz; vec3 toC=base-uCam;
  vec3 r=normalize(cross(vec3(0.,1.,0.),toC)+1e-5);
  float age=uT-iBm.w;
  vec3 p=base+r*side*1.6+vec3(0.,v*700.*smoothstep(0.,.8,age),0.);
  vS=side; vV=v; vAge=age; vF=exp(-length(toC)*.002);
  gl_Position=uVP*vec4(p,1.);
}`, `in float vS; in float vV; in float vAge; in float vF; out vec4 o;
void main(){
  float a=pow(1.-vS*vS,2.)*pow(1.-vV,1.4);
  o=vec4(uPal[0]*a*mix(4.,.7,smoothstep(.8,4.,vAge))*vF,1.);
}`];

const ATK = [`
layout(location=0) in vec3 iA; layout(location=1) in vec3 iB; layout(location=2) in vec4 iP;
uniform float uAge;
out float vA; out float vS; out vec3 vC;
vec3 arc(float s){vec3 p=mix(iA,iB,s);p.y+=sin(3.14159*s)*iP.w;return p;}
void main(){
  float e=float(gl_VertexID>>1), side=float(gl_VertexID&1)*2.-1.;
  float s0=uAge*iP.x-iP.y, s=clamp(s0,0.,1.), L=clamp(40./(length(iB-iA)+iP.w),.03,.3);
  vec3 p=arc(max(s-e*L,0.));
  vec3 t=normalize(arc(min(s,.998)+.002)-arc(max(s-L,0.))+1e-5);
  float dist=length(p-uCam);
  p+=normalize(cross(t,normalize(p-uCam))+1e-5)*side*(.5+dist*.002);
  vS=side; vC=uPal[int(iP.z+.5)];
  float fade=iP.z>4.5?1.-smoothstep(4.6,5.1,uAge):1.;
  vA=(1.-e)*step(0.,s0)*step(s0,1.)*fade;
  gl_Position=uVP*vec4(p,1.);
}`, `in float vA; in float vS; in vec3 vC; out vec4 o; void main(){o=vec4(vC*vA*(1.-vS*vS)*7.,1.);}`];

const BRIGHT = [TRI, `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTx; uniform float uThr; out vec4 o;
void main(){
  vec3 c=(texture(uTex,vUv+uTx*vec2(-1.,-1.)).rgb+texture(uTex,vUv+uTx*vec2(1.,-1.)).rgb+texture(uTex,vUv+uTx*vec2(-1.,1.)).rgb+texture(uTex,vUv+uTx).rgb)*.25;
  float l=max(c.r,max(c.g,c.b));
  o=vec4(min(c*smoothstep(uThr,uThr+1.,l),vec3(60.)),1.);
}`];
const BLUR = [TRI, `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 c=texture(uTex,vUv).rgb*.227027;
  c+=(texture(uTex,vUv+uDir*1.3846).rgb+texture(uTex,vUv-uDir*1.3846).rgb)*.3162162;
  c+=(texture(uTex,vUv+uDir*3.2308).rgb+texture(uTex,vUv-uDir*3.2308).rgb)*.0702703;
  o=vec4(c,1.);
}`];
const COMP = [TRI, `
in vec2 vUv; uniform sampler2D uS,uB1,uB2,uB3; uniform float uGrain,uAlarm,uExpo; out vec4 o;
void main(){
  vec2 d=vUv-.5; float r2=dot(d,d);
  vec3 c=vec3(texture(uS,vUv-d*r2*.01).r,texture(uS,vUv).g,texture(uS,vUv+d*r2*.01).b);
  vec3 b=texture(uB1,vUv).rgb*.5+texture(uB2,vUv).rgb*.4+texture(uB3,vUv).rgb*.35;
  float dirt=smoothstep(.45,.85,vnz(vUv*vec2(7.,4.))*.65+vnz(vUv*23.+3.)*.35);
  c+=b*.55+b*dirt*.6;
  c+=uPal[5]*uAlarm*smoothstep(.06,.5,r2)*.6;
  c=aces(c*uExpo);
  c=pow(c,vec3(1./2.2));
  float l=dot(c,vec3(.299,.587,.114));
  c=mix(c*vec3(.94,1.,1.07),c*vec3(1.05,1.,.93),smoothstep(.2,.8,l));
  c*=1.-r2*.85;
  c+=(h1(gl_FragCoord.xy+fract(uT*7.)*91.)-.5)*.035*uGrain;
  o=vec4(c,1.);
}`];

NW.SH = {HEAD, SKY, BLD, CAR, POOL, SIGN, CONE, GROUND, RAIN, BEAM, ATK, BRIGHT, BLUR, COMP};
})();
