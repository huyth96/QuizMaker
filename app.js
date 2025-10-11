/* MLN111 – Quiz App (per-question flow upgraded + bulk mode) */
(() => {
  const DEFAULT_JSON = 'MLN111_quiz_sources.json'; // đổi nếu cần
  const LS_SETTINGS = 'mln111_settings_v2';
  const LS_PROGRESS = 'mln111_progress_v2';

  let DATA = null;            // full dataset
  let RENDER_ITEMS = [];      // current session items (filtered+randomized)
  let MODE = 'per';           // 'per' | 'bulk'

  // Per-question flow state
  const PER_AUTONEXT_MS = 3000;
  let perIndex = 0;
  let perTimer = null;

  const els = {
    datasetStatus: document.getElementById('datasetStatus'),
    btnFetchDefault: document.getElementById('btnFetchDefault'),
    fileInput: document.getElementById('fileInput'),
    chapterSelect: document.getElementById('chapterSelect'),
    limitInput: document.getElementById('limitInput'),
    searchInput: document.getElementById('searchInput'),
    shuffleQuestions: document.getElementById('shuffleQuestions'),
    shuffleOptions: document.getElementById('shuffleOptions'),
    btnStart: document.getElementById('btnStart'),
    btnReset: document.getElementById('btnReset'),
    modePer: document.getElementById('modePer'),
    modeBulk: document.getElementById('modeBulk'),
    metaTotal: document.getElementById('metaTotal'),
    metaShown: document.getElementById('metaShown'),
    score: document.getElementById('score'),
    quiz: document.getElementById('quiz'),
    btnSubmitAll: document.getElementById('btnSubmitAll'),
    btnRevealAll: document.getElementById('btnRevealAll'),
    btnClearReveal: document.getElementById('btnClearReveal'),
    footerInfo: document.getElementById('footerInfo'),
  };

  // ===== Utilities =====
  const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);
  const shuffle = (arr)=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };
  const loadSettings = ()=>{ try { return JSON.parse(localStorage.getItem(LS_SETTINGS)||'{}'); } catch { return {}; } };
  const saveSettings = (o)=>localStorage.setItem(LS_SETTINGS, JSON.stringify(o||{}));
  const loadProgress = ()=>{ try { return JSON.parse(localStorage.getItem(LS_PROGRESS)||'{}'); } catch { return {}; } };
  const saveProgress = (o)=>localStorage.setItem(LS_PROGRESS, JSON.stringify(o||{}));
  const clearProgress = ()=>localStorage.removeItem(LS_PROGRESS);
  const setBadge = (el, text, variant='neutral')=>{ el.textContent=text; el.className=`badge ${variant}`; };
  const sameSet = (a,b)=>{ if(!Array.isArray(a)||!Array.isArray(b)) return false; const sa=new Set(a.map(x=>x.toLowerCase())); const sb=new Set(b.map(x=>x.toLowerCase())); if(sa.size!==sb.size) return false; for(const x of sa) if(!sb.has(x)) return false; return true; };

  // ===== Data loading =====
  async function fetchDefault(){
    try{
      const res = await fetch(DEFAULT_JSON, {cache:'no-store'});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
      postLoad();
      setBadge(els.datasetStatus, 'Đã tải mặc định', 'ok');
    }catch(e){
      console.warn(e);
      setBadge(els.datasetStatus, 'Không tìm thấy JSON mặc định', 'warn');
    }
  }
  function readFile(file){
    const fr = new FileReader();
    fr.onload = ()=>{
      try{
        DATA = JSON.parse(fr.result);
        postLoad();
        setBadge(els.datasetStatus, `Đã tải: ${file.name}`, 'ok');
      }catch(e){
        console.error(e);
        setBadge(els.datasetStatus, 'File không hợp lệ', 'err');
      }
    };
    fr.readAsText(file, 'utf-8');
  }
  function postLoad(){
    if(!DATA || !DATA.items) return;
    const chapters = [...new Set(DATA.items.map(x=>x.chapter_code))].sort();
    els.chapterSelect.innerHTML = `<option value="__all__">Tất cả chương</option>` + chapters.map(c=>`<option value="${c}">${c}</option>`).join('');
    els.metaTotal.textContent = DATA.total_questions || DATA.items.length;
    els.footerInfo.textContent = `Nguồn: ${DEFAULT_JSON} (${DATA.items.length} câu)`;
    const s = loadSettings();
    if(s.limit) els.limitInput.value = s.limit;
    if(s.chapter) els.chapterSelect.value = s.chapter;
    if(typeof s.shuffleQuestions==='boolean') els.shuffleQuestions.checked = s.shuffleQuestions;
    if(typeof s.shuffleOptions==='boolean') els.shuffleOptions.checked = s.shuffleOptions;
    if(s.mode) applyMode(s.mode);
  }

  // ===== Filtering =====
  function prepareItems(forceShuffle=false){
    if(!DATA) return [];
    const chapter = els.chapterSelect.value;
    const kw = (els.searchInput.value||'').toLowerCase().trim();
    let items = DATA.items.slice();
    if(chapter && chapter!=='__all__') items = items.filter(x => (x.chapter_code||'')===chapter);
    if(kw){
      items = items.filter(x=>{
        const t=(x.question||'').toLowerCase();
        const ops=(x.options||[]).map(o=>o.text.toLowerCase()).join(' ');
        return t.includes(kw)||ops.includes(kw);
      });
    }
    const limit = clamp(parseInt(els.limitInput.value||'0',10)||0, 1, items.length||1);
    if(forceShuffle || els.shuffleQuestions.checked) items = shuffle(items);
    items = items.slice(0, limit);
    if(els.shuffleOptions.checked) items = items.map(it=>({...it, options: shuffle(it.options||[])}));
    return items;
  }

  function applyMode(mode){
    MODE = mode;
    if(MODE==='per'){
      els.modePer.classList.add('active'); els.modeBulk.classList.remove('active');
      els.btnSubmitAll.style.display = 'none';
    }else{
      els.modeBulk.classList.add('active'); els.modePer.classList.remove('active');
      els.btnSubmitAll.style.display = 'inline-flex';
    }
    const s = loadSettings(); s.mode = MODE; saveSettings(s);
  }

  // ===== Rendering helpers (cards) =====
  function buildCard(q, index, groupName){
    const card = document.createElement('article'); card.className='q-card'; card.dataset.qid = q.id;
    const head = document.createElement('div'); head.className='q-head';

    const order = document.createElement('span'); order.className='q-order'; order.textContent = `#${index+1}`;
    const chap = document.createElement('span'); chap.className='q-chapter badge'; chap.textContent = q.chapter_code || 'Chương?';
    const ttype = document.createElement('span'); ttype.className='q-type badge'; ttype.textContent = (q.correct_keys && q.correct_keys.length>1) ? 'Multiple' : 'Single';
    const status = document.createElement('span'); status.className='q-status badge pending'; status.textContent='Chưa làm';
    head.append(order, chap, ttype, status);

    const text = document.createElement('div'); text.className='q-text'; text.textContent = q.question || '(Không có nội dung câu hỏi)';

    const opsWrap = document.createElement('div'); opsWrap.className='q-options';
    const isMulti = (q.correct_keys||[]).length>1;
    (q.options||[]).forEach(op=>{
      const row = document.createElement('label'); row.className='opt';
      const input = document.createElement('input'); input.type = isMulti ? 'checkbox' : 'radio'; input.name = groupName; input.value = op.key;
      const keySpan = document.createElement('span'); keySpan.className='key'; keySpan.textContent = (op.key||'?').toUpperCase();
      const txtSpan = document.createElement('span'); txtSpan.className='txt'; txtSpan.textContent = op.text || '';
      row.append(input, keySpan, txtSpan); opsWrap.append(row);
    });

    const foot = document.createElement('div'); foot.className='q-foot';
    const ans = document.createElement('span'); ans.className='ans badge info'; ans.textContent = (q.correct_keys && q.correct_keys.length) ? `Đáp án: ${q.correct_keys.join(', ').toUpperCase()}` : 'Chưa có đáp án';
    const btnNext = document.createElement('button'); btnNext.className='btn tiny ghost'; btnNext.textContent='Tiếp';
    btnNext.addEventListener('click', ()=> goNextPer());
    foot.append(ans, btnNext);

    card.append(head, text, opsWrap, foot);
    return card;
  }

  function getSelections(card){ return Array.from(card.querySelectorAll('input:checked')).map(x=>x.value); }

  function gradeCard(card, q, revealCorrect=true){
    const status = card.querySelector('.q-status');
    const opts = Array.from(card.querySelectorAll('.opt'));
    const selected = getSelections(card);
    opts.forEach(o=>o.classList.remove('correct','wrong'));
    card.classList.remove('revealed');

    const hasAns = Array.isArray(q.correct_keys) && q.correct_keys.length>0;
    if(!hasAns){
      status.className='q-status badge done';
      status.textContent = selected.length ? 'Đã chọn (chưa có đáp án)' : 'Chưa làm';
      return {graded:false, ok:false};
    }
    const ok = sameSet(selected, q.correct_keys);
    opts.forEach(opt=>{
      const key = opt.querySelector('input').value;
      if(selected.includes(key) && !q.correct_keys.includes(key)){ opt.classList.add('wrong'); }
      if(q.correct_keys.includes(key) && (revealCorrect || selected.includes(key))){ opt.classList.add('correct'); }
    });
    card.classList.add('revealed');
    if(selected.length===0){ status.className='q-status badge pending'; status.textContent='Chưa làm'; }
    else if(ok){ status.className='q-status badge right'; status.textContent='Đúng'; }
    else { status.className='q-status badge wrong'; status.textContent='Sai'; }
    return {graded:true, ok};
  }

  // ===== Score across items (not depending on DOM) =====
  function computeScore(items){
    const progress = loadProgress();
    let correct=0, total=0;
    items.forEach(q=>{
      const hasAns = Array.isArray(q.correct_keys)&&q.correct_keys.length>0;
      if(!hasAns) return;
      total++;
      const sel = (progress[q.id] && progress[q.id].selected) ? progress[q.id].selected : [];
      if(sameSet(sel, q.correct_keys)) correct++;
    });
    return {correct, total};
  }
  function showScoreMeta(){
    const {correct,total} = computeScore(RENDER_ITEMS);
    els.score.textContent = `${correct} / ${total}`;
  }

  // ====== PER-QUESTION FLOW ======
  function startPerFlow(){
    // Force random câu hỏi
    RENDER_ITEMS = prepareItems(true);
    els.metaShown.textContent = RENDER_ITEMS.length.toString();
    perIndex = 0;
    renderPerQuestion();
  }

  function renderPerQuestion(){
    clearTimeout(perTimer); perTimer=null;
    els.quiz.innerHTML = '';

    if(perIndex >= RENDER_ITEMS.length){
      // Finish screen
      const {correct,total} = computeScore(RENDER_ITEMS);
      const wrap = document.createElement('div'); wrap.className='finish-card q-card';
      wrap.innerHTML = `
        <h2>Hoàn thành 🎉</h2>
        <p>Bạn đúng <strong>${correct}</strong> / <strong>${total}</strong> câu có đáp án.</p>
        <div style="margin-top:12px; display:flex; gap:10px; justify-content:center;">
          <button class="btn primary" id="btnRedo">Làm lại</button>
          <button class="btn ghost" id="btnReview">Xem lại (hàng loạt)</button>
        </div>
      `;
      els.quiz.append(wrap);
      document.getElementById('btnRedo').onclick = ()=>{ clearProgress(); startPerFlow(); showScoreMeta(); };
      document.getElementById('btnReview').onclick = ()=>{ applyMode('bulk'); renderBulkList(); };
      showScoreMeta();
      return;
    }

    const q = RENDER_ITEMS[perIndex];
    // Header with progress bar 3s (starts only after chọn)
    const perHead = document.createElement('div'); perHead.className='per-head';
    perHead.innerHTML = `
      <div class="lhs">Câu <strong>${perIndex+1}</strong> / ${RENDER_ITEMS.length}</div>
      <div class="progress"><div class="bar" id="autoBar"></div></div>
    `;
    els.quiz.append(perHead);

    const card = buildCard(q, perIndex, `per-${q.id}`);
    els.quiz.append(card);
    showScoreMeta();

    // Interactions: select => grade => save => countdown 3s => next
    card.querySelectorAll('input').forEach(input=>{
      input.addEventListener('change', ()=>{
        // save selections
        const progress = loadProgress();
        const sel = getSelections(card);
        progress[q.id] = {selected: sel};
        saveProgress(progress);

        // grade + reveal
        gradeCard(card, q, true);
        showScoreMeta();

        // run 3s bar then next
        const bar = document.getElementById('autoBar');
        bar.classList.remove('run'); // restart animation if user changes choice
        // force reflow to replay animation
        void bar.offsetWidth;
        bar.classList.add('run');

        clearTimeout(perTimer);
        perTimer = setTimeout(()=>{ goNextPer(); }, PER_AUTONEXT_MS);
      }, {once:false});
    });
  }

function goNextPer(){
  clearTimeout(perTimer);
  perTimer = null;
  perIndex++;
  renderPerQuestion();
  // window.scrollTo({ top: 0, behavior: 'smooth' }); // ❌ bỏ cuộn về đầu
}


  // ====== BULK LIST (giữ nguyên logic cũ) ======
  function renderBulkList(){
    RENDER_ITEMS = prepareItems(els.shuffleQuestions.checked);
    els.metaShown.textContent = RENDER_ITEMS.length.toString();
    els.quiz.innerHTML = '';

    RENDER_ITEMS.forEach((q, idx)=>{
      const card = buildCard(q, idx, `q-${q.id}`);
      els.quiz.append(card);

      // Restore selections
      const progress = loadProgress();
      const savedSel = (progress[q.id] && progress[q.id].selected) ? progress[q.id].selected : [];
      savedSel.forEach(k=>{
        const input = card.querySelector(`input[value="${k}"]`);
        if(input) input.checked = true;
      });

      // change events (no auto-next in bulk)
      card.querySelectorAll('input').forEach(input=>{
        input.addEventListener('change', ()=>{
          const curr = loadProgress();
          const sel = getSelections(card);
          curr[q.id] = {selected: sel};
          saveProgress(curr);
        });
      });
    });

    showScoreMeta();
  }

  function gradeAllBulk(){
    const cards = Array.from(els.quiz.querySelectorAll('.q-card'));
    cards.forEach((card, idx)=>{
      const q = RENDER_ITEMS[idx];
      gradeCard(card, q, true);
    });
    showScoreMeta();
    window.scrollTo({top:0, behavior:'smooth'});
  }

  // ===== Events =====
  els.btnFetchDefault.addEventListener('click', fetchDefault);
  els.fileInput.addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0]; if(f) readFile(f);
  });

  els.modePer.addEventListener('click', ()=>applyMode('per'));
  els.modeBulk.addEventListener('click', ()=>applyMode('bulk'));

  els.btnStart.addEventListener('click', ()=>{
    // save settings
    const s = loadSettings();
    s.limit = parseInt(els.limitInput.value||'0',10) || 20;
    s.chapter = els.chapterSelect.value;
    s.shuffleQuestions = !!els.shuffleQuestions.checked;
    s.shuffleOptions = !!els.shuffleOptions.checked;
    saveSettings(s);

    if(MODE==='per'){
      // Per-mode: luôn random câu hỏi
      startPerFlow();
    }else{
      renderBulkList();
    }
  });

  els.btnReset.addEventListener('click', ()=>{
    clearProgress(); clearTimeout(perTimer); perTimer=null;
    if(MODE==='per') startPerFlow(); else renderBulkList();
  });

  els.btnSubmitAll.addEventListener('click', gradeAllBulk);
  els.btnRevealAll.addEventListener('click', ()=>{
    // reveal correct options visually (bulk)
    els.quiz.querySelectorAll('.q-card').forEach((card, idx)=>{
      gradeCard(card, RENDER_ITEMS[idx], true);
    });
  });
  els.btnClearReveal.addEventListener('click', ()=>{
    els.quiz.querySelectorAll('.q-card').forEach(card=>{
      card.classList.remove('revealed');
      card.querySelectorAll('.opt.correct').forEach(o=>o.classList.remove('correct'));
      card.querySelectorAll('.opt.wrong').forEach(o=>o.classList.remove('wrong'));
      const status = card.querySelector('.q-status');
      status.className='q-status badge pending'; status.textContent='Chưa làm';
    });
  });

  els.searchInput.addEventListener('input', ()=>{
    if(MODE==='per') startPerFlow(); else renderBulkList();
  });

  // Startup
  fetchDefault();
})();
