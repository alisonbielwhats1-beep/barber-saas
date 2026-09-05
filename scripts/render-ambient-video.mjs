import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) throw Error('WebGL unavailable');
    function shader(type, source) {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `precision mediump float;
      varying vec2 uv; uniform float time;
      void main(){
        vec2 p=uv; float t=time*6.2831853; float light=0.;
        for(int i=0;i<7;i++){
          float n=float(i); float x=.12+n*.13+.095*sin(p.y*3.8+t+n*.6);
          float wave=exp(-abs(p.x-x)*mix(15.,48.,.5+.5*sin(t+n)));
          light+=wave*(.065+.035*cos(p.y*5.-t+n));
        }
        float glow=.11+.4*light+.15*(.5+.5*sin(p.x*4.+p.y*3.+t));
        gl_FragColor=vec4(vec3(glow*.98,glow*.96,glow*.93),1.);
      }`));
    gl.linkProgram(program); gl.useProgram(program);
    const buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const time=gl.getUniformLocation(program,'time'); gl.viewport(0,0,1280,720);
    const stream=canvas.captureStream(24);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1200000});
    const chunks=[]; recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start(); const start=performance.now();
    await new Promise(resolve=>{
      function draw(now){ const elapsed=now-start; gl.uniform1f(time,elapsed/8000);gl.drawArrays(gl.TRIANGLES,0,6);if(elapsed<8000)requestAnimationFrame(draw);else resolve(); }
      requestAnimationFrame(draw);
    });
    recorder.stop(); await done; stream.getTracks().forEach(track=>track.stop());
    return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));});
  });
  await writeFile('public/images/atelier-motion.webm', Buffer.from(encoded,'base64'));
  console.log('Ambient light loop saved:', Buffer.from(encoded,'base64').length, 'bytes');
} finally { await browser.close(); }
