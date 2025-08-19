// ===================== Utility helpers =====================
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const toHex = (n)=>n.toString(16).padStart(2,'0');
const rgbToHex = (r,g,b)=>`#${toHex(r)}${toHex(g)}${toHex(b)}`;
const dist2 = (a,b)=>{ const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2]; return dr*dr+dg*dg+db*db; };
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

// Global state
const state = {
  img: null,
  gridW: 28,
  gridH: 0,
  cellPx: 18,
  pixels: [],            // [ [r,g,b], ... ] length = gridW*gridH
  uniqueColors: [],      // [ [r,g,b,count], ... ] sorted by count desc
  palette: [],           // current palette of length K
  indices: [],           // per-pixel palette index
  inPlay: false
};

// ===================== Image → grid + palette candidates =====================
async function fileToImage(file){
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function drawAndSample(img, gridW){
  const ratio = img.height / img.width;
  const gridH = Math.max(1, Math.round(gridW * ratio));
  const cvs = document.getElementById('workCanvas');
  cvs.width = gridW; cvs.height = gridH;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, gridW, gridH);
  const data = ctx.getImageData(0,0,gridW,gridH).data;

  const pixels = new Array(gridW*gridH);
  for(let i=0;i<pixels.length;i++){
    const o=i*4; pixels[i] = [data[o],data[o+1],data[o+2]]; // ignore alpha
  }

  // Build exact-color histogram (STEP=1) so max unique = pixel count → effectively no fixed cap
  const hist = new Map();
  for(const [r,g,b] of pixels){
    const key = (r<<16)|(g<<8)|b;
    hist.set(key, (hist.get(key)||0)+1);
  }
  const uniqueColors = Array.from(hist.entries())
    .map(([key,count])=>[((key>>16)&255),((key>>8)&255),(key&255),count])
    .sort((a,b)=>b[3]-a[3]);

  state.gridW = gridW; state.gridH = gridH; state.pixels = pixels; state.uniqueColors = uniqueColors;

  // Update slider cap dynamically (no fixed upper limit; bound only by image detail)
  const maxColorsRange = document.getElementById('maxColors');
  const maxCap = Math.max(1, uniqueColors.length);
  maxColorsRange.max = String(maxCap);
  if(Number(maxColorsRange.value) > maxCap) maxColorsRange.value = String(maxCap);
  document.getElementById('colorCapHint').textContent = `(max for this image: ${maxCap})`;

  return {gridH, pixels, uniqueColors};
}

function quantizeWithK(K){
  const {pixels, uniqueColors} = state;
  const Ksafe = clamp(K,1, Math.max(1, uniqueColors.length));
  const palette = uniqueColors.slice(0, Ksafe).map(([r,g,b])=>[r,g,b]);
  const indices = new Array(pixels.length);
  for(let i=0;i<pixels.length;i++){
    const px = pixels[i];
    let best=0, bestD=Infinity;
    for(let k=0;k<palette.length;k++){
      const d = dist2(px, palette[k]);
      if(d<bestD){ bestD=d; best=k; }
    }
    indices[i]=best;
  }
  state.palette = palette; state.indices = indices;
  return {palette, indices};
}

// ===================== Math problems (11 & 12 families) =====================
function buildProblems(){
  const minF = parseInt(document.getElementById('factorMin').value, 10) || 1;
  const maxF = parseInt(document.getElementById('factorMax').value, 10) || 12;
  const probs = [];
  for(let i = minF; i <= maxF; i++){
    for(let j = minF; j <= maxF; j++){
      probs.push({ q: `${i} × ${j}`, a: i * j });
    }
  }
  return shuffle(probs);
}


// ===================== Rendering =====================
function ensureGridDOM(gridW, gridH){
  const grid = document.getElementById('grid');
  grid.style.gridTemplateColumns = `repeat(${gridW}, var(--cellSize))`;
  grid.innerHTML='';
  const frag = document.createDocumentFragment();
  for(let i=0;i<gridW*gridH;i++){
    const cell=document.createElement('div');
    cell.className='cell';
    cell.dataset.idx = String(i);
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
}

function renderPreview(){
  // Colors are filled immediately as the color slider moves → live preview
  const {gridW, gridH, palette, indices} = state;
  ensureGridDOM(gridW, gridH);
  const cells = document.querySelectorAll('#grid .cell');
  for(let i=0;i<cells.length;i++){
    const cid = indices[i];
    const [r,g,b] = palette[cid];
    cells[i].style.background = rgbToHex(r,g,b);
    cells[i].classList.add('done'); // hide numbers in preview
    cells[i].textContent = '';
    cells[i].dataset.cid = String(cid);
  }
  renderLegend(palette, null);
}

function renderPuzzle(){
  const {gridW, gridH, palette, indices, cellPx} = state;
  const grid = document.getElementById('grid');
  grid.style.setProperty('--cellSize', cellPx+'px');
  ensureGridDOM(gridW, gridH);

  // Numbers only (no colors yet)
  const cells = document.querySelectorAll('#grid .cell');
  for(let i=0;i<cells.length;i++){
    const cid = indices[i];
    cells[i].style.background = 'var(--cell)';
    cells[i].classList.remove('done');
    cells[i].textContent = String(cid+1);
    cells[i].dataset.cid = String(cid);
  }

  renderLegend(palette, []); // will fill problems after gameplay setup
}

function renderLegend(palette, problems){
  const legend = document.getElementById('legend');
  legend.innerHTML='';
  const colorMap = palette.map(([r,g,b])=>rgbToHex(r,g,b));
  for(let k=0;k<palette.length;k++){
    const item=document.createElement('div'); item.className='item';
    const sw=document.createElement('div'); sw.className='swatch'; sw.style.background=colorMap[k];
    const label=document.createElement('div');
    const prob = problems && problems[k] ? problems[k].q : '&nbsp;';
    label.innerHTML=`<strong>${k+1}</strong> <span id="leg-${k}" style="color:#94a3b8;margin-left:4px">${prob}</span>`;
    item.appendChild(sw); item.appendChild(label); legend.appendChild(item);
  }
}

function colorDistance(c1, c2){
  const dr = c1[0] - c2[0];
  const dg = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  return dr*dr + dg*dg + db*db;
}

function groupColorsBySimilarity(palette, numGroups){
  const colorsLeft = palette.map((c,i)=>({color:c, index:i}));
  const groups = Array.from({length:numGroups}, ()=>[]);

 for(let g=0; g<numGroups; g++){
    if(colorsLeft.length === 0) break;

    // Pick a random starting color for this group
   const seedIndex = Math.floor(Math.random() * colorsLeft.length);
    const seed = colorsLeft.splice(seedIndex, 1)[0];
    groups[g].push(seed.index);

   if(colorsLeft.length === 0) continue;

   // Fill rest of the group with closest colors
    const targetSize = Math.ceil(palette.length / numGroups);
    while(groups[g].length < targetSize && colorsLeft.length > 0){
      let bestIdx = 0;
      let bestDist = Infinity;
     for(let i=0; i<colorsLeft.length; i++){
       const dist = colorDistance(seed.color, colorsLeft[i].color);
       if(dist < bestDist){
         bestDist = dist;
         bestIdx = i;
       }
     }
     groups[g].push(colorsLeft[bestIdx].index);
     colorsLeft.splice(bestIdx, 1);
   }
 }

  return groups;
}


// ===================== Gameplay =====================
function setupGameplay(){
  const { palette } = state;
  const totalColors = palette.length;
  const numQuestions = clamp(parseInt(document.getElementById('numQuestions').value,10), 1, totalColors);

  // Build problems
  const pool = buildProblems();
  const problems = [];
  while(problems.length < numQuestions){ problems.push(...shuffle(pool.slice())); }

  // Group colors evenly across questions
  const colorGroups = groupColorsBySimilarity(palette, numQuestions);


  // Map each group to one problem
  const groupProblems = colorGroups.map((group, idx)=>({
    colors: group,
    problem: problems[idx]
  }));

// Fill legend — each color shows its group's problem
  groupProblems.forEach((gp, gIndex)=>{
    gp.colors.forEach(colorIndex=>{
      const el = document.getElementById('leg-'+colorIndex);
      if(el) el.textContent = gp.problem.q;
    });
  });

  // Gameplay state
  const remainingGroups = new Set(groupProblems.map((_, i)=>i));
  let currentGroupIndex = null;

  function pickNext(){
    if(remainingGroups.size === 0){
      setQuestion('All done! 🎉');
      disablePlay(true);
      return;
    }
    const choices = Array.from(remainingGroups);
    currentGroupIndex = choices[Math.floor(Math.random()*choices.length)];
    setQuestion(groupProblems[currentGroupIndex].problem.q);
  }

 function setQuestion(t){ document.getElementById('question').textContent = t; }
 function disablePlay(flag){
   document.getElementById('submitBtn').disabled = flag;
   document.getElementById('skipBtn').disabled = flag;
   document.getElementById('revealBtn').disabled = flag;
   document.getElementById('answer').disabled = flag;
 }
 function updateCounters(){
   const solved = (numQuestions - remainingGroups.size);
   document.getElementById('solvedCount').textContent = String(solved);
   document.getElementById('totalProblems').textContent = String(numQuestions);
 }
 function revealGroup(gIndex){
   groupProblems[gIndex].colors.forEach(cid=>{
     const cells = document.querySelectorAll(`.cell[data-cid="${cid}"]`);
     const [r,g,b] = palette[cid];
     const color = rgbToHex(r,g,b);
     cells.forEach(c=>{
       c.style.background = color;
       c.classList.add('done');
       c.textContent='';
     });
    });
  }

  function handleSubmit(){
    const inp = document.getElementById('answer');
    const val = Number(inp.value.trim());
    const expected = groupProblems[currentGroupIndex].problem.a;
    if(Number.isFinite(val) && val === expected){
      revealGroup(currentGroupIndex);
      remainingGroups.delete(currentGroupIndex);
      updateCounters();
      inp.value='';
      pickNext();
    } else {
      document.getElementById('submitBtn').animate(
        [{transform:'translateX(0px)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0px)'}],
        {duration:150}
      );
    }
  }

  document.getElementById('submitBtn').onclick = handleSubmit;
  document.getElementById('answer').onkeydown = (e)=>{ if(e.key==='Enter') handleSubmit(); };
  document.getElementById('skipBtn').onclick = ()=>{ pickNext(); };
  document.getElementById('revealBtn').onclick = ()=>{
    for(const gIndex of Array.from(remainingGroups)) revealGroup(gIndex);
    remainingGroups.clear();
    updateCounters();
    pickNext();
  };

  disablePlay(false);
  updateCounters();
  pickNext();
}


// ===================== Wiring =====================
const fileInput = document.getElementById('fileInput');
const previewBtn = document.getElementById('previewBtn');
const generateBtn = document.getElementById('generateBtn');
const submitBtn = document.getElementById('submitBtn');
const skipBtn = document.getElementById('skipBtn');
const revealBtn = document.getElementById('revealBtn');
const gridWRange = document.getElementById('gridW');
const maxColorsRange = document.getElementById('maxColors');
const cellSizeRange = document.getElementById('cellSize');
const gridWVal = document.getElementById('gridWVal');
const maxColorsVal = document.getElementById('maxColorsVal');
const cellSizeVal = document.getElementById('cellSizeVal');

gridWRange.oninput = async ()=>{
  gridWVal.textContent = gridWRange.value;
  if(state.img){
    // Re-sample and refresh preview for new width
    drawAndSample(state.img, parseInt(gridWRange.value,10));
    const K = parseInt(maxColorsRange.value,10) || 1;
    quantizeWithK(K);
    renderPreview();
  }
};
maxColorsRange.oninput = ()=>{
  maxColorsVal.textContent = maxColorsRange.value;
  if(!state.img) return;
  // As slider moves up, recompute and fill colors immediately (preview)
  const K = parseInt(maxColorsRange.value,10) || 1;
  quantizeWithK(K);
  renderPreview();
};
cellSizeRange.oninput = ()=>{
  cellSizeVal.textContent = cellSizeRange.value;
  document.getElementById('grid').style.setProperty('--cellSize', cellSizeRange.value+'px');
  state.cellPx = parseInt(cellSizeRange.value,10);
};

fileInput.addEventListener('change', async ()=>{
  const hasFile = !!fileInput.files?.length;
  previewBtn.disabled = generateBtn.disabled = !hasFile;
  if(!hasFile) return;

  state.img = await fileToImage(fileInput.files[0]);
  // Initial sample & preview build
  drawAndSample(state.img, parseInt(gridWRange.value,10));
  const K = parseInt(maxColorsRange.value,10) || 8;
  quantizeWithK(K);
  renderPreview();
});

previewBtn.addEventListener('click', ()=>{
  if(!state.img) return;
  const K = parseInt(maxColorsRange.value,10) || 8;
  quantizeWithK(K);
  renderPreview();
});

generateBtn.addEventListener('click', ()=>{
    if(!state.img) return;
    state.inPlay = true;
    // Freeze current K and render puzzle view (numbers), shuffle problems every time
    const K = parseInt(maxColorsRange.value,10) || 8;
    quantizeWithK(K);
    renderPuzzle();
    setupGameplay();
    submitBtn.disabled = skipBtn.disabled = revealBtn.disabled = false;
  });

  
    
  

// Init defaults
document.getElementById('grid').style.setProperty('--cellSize', cellSizeRange.value+'px');