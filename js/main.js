(async function(){
  'use strict';

  // ---------- SUPABASE ----------
  const config = window.UNDIAN_CONFIG || {};
  const SUPABASE_URL = (config.SUPABASE_URL || '').trim();
  const SUPABASE_ANON_KEY = (config.SUPABASE_ANON_KEY || '').trim();

  const hasSupabase = !!(window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY);
  const supabase = hasSupabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  // ---------- STATE ----------
  const state = {
    total: 20,
    remaining: [],
    history: [],
    overrideQueue: [], // [{seq, number}]
  };

  // ---------- DATA (Supabase RPC) ----------
  async function loadState(){
    const { data, error } = await supabase.rpc('get_state');
    if (error) throw new Error(error.message);
    state.total = data.total;
    state.remaining = data.remaining;
    state.history = data.history;
    state.overrideQueue = data.overrideQueue || [];
  }

  // ---------- MUAT MARKUP ADMIN (file terpisah) ----------
  const adminHost = document.createElement('div');
  document.body.appendChild(adminHost);
  let adminReady = false;
  try{
    const res = await fetch('master.html');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    adminHost.innerHTML = await res.text();
    adminReady = true;
  }catch(e){
    console.warn('Panel admin tidak dapat dimuat (buka via server/GitHub Pages, bukan file://):', e.message);
  }

  // ---------- DOM ----------
  const reelRow = document.getElementById('reelRow');
  const drawBtn = document.getElementById('drawBtn');
  const statusMsg = document.getElementById('statusMsg');
  const remainingCountEl = document.getElementById('remainingCount');
  const drawnCountEl = document.getElementById('drawnCount');
  const historyList = document.getElementById('historyList');

  const secretDot = document.getElementById('secretDot');
  const maxDrawInput = document.getElementById('maxDrawInput');
  const applyMaxBtn = document.getElementById('applyMaxBtn');
  const resetBtn = document.getElementById('resetBtn');

  const pinOverlay = document.getElementById('pinOverlay');
  const pinInput = document.getElementById('pinInput');
  const pinError = document.getElementById('pinError');
  const pinSubmitBtn = document.getElementById('pinSubmitBtn');
  const pinCancelBtn = document.getElementById('pinCancelBtn');

  const adminOverlay = document.getElementById('adminOverlay');
  const poolGrid = document.getElementById('poolGrid');
  const overrideInput = document.getElementById('overrideInput');
  const addOverrideBtn = document.getElementById('addOverrideBtn');
  const overrideList = document.getElementById('overrideList');
  const newPinInput = document.getElementById('newPinInput');
  const savePinBtn = document.getElementById('savePinBtn');
  const closeAdminBtn = document.getElementById('closeAdminBtn');

  const mode1Tab = document.getElementById('mode1Tab');
  const mode2Tab = document.getElementById('mode2Tab');

  const groupInput = document.getElementById('groupInput');
  const saveGroupsBtn = document.getElementById('saveGroupsBtn');
  const groupChips = document.getElementById('groupChips');
  const drawGroupBtn = document.getElementById('drawGroupBtn');
  const resetGroupDrawMainBtn = document.getElementById('resetGroupDrawMainBtn');
  const clearGroupDataMainBtn = document.getElementById('clearGroupDataMainBtn');
  const groupStatusMsg = document.getElementById('groupStatusMsg');
  const groupResult = document.getElementById('groupResult');
  const groupHistory = document.getElementById('groupHistory');
  const groupsAdmin = document.getElementById('groupsAdmin');
  const groupsForceInput = document.getElementById('groupsForceInput');
  const saveGroupsForceBtn = document.getElementById('saveGroupsForceBtn');
  const resetGroupDrawBtn = document.getElementById('resetGroupDrawBtn');
  const clearGroupDataBtn = document.getElementById('clearGroupDataBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const noMapBody = document.getElementById('noMapBody');
  const addNoMapRowBtn = document.getElementById('addNoMapRowBtn');
  const saveNoMapBtn = document.getElementById('saveNoMapBtn');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMsg = document.getElementById('confirmMsg');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');

  let spinning = false;
  let drawingGroup = false;

  // ---------- MODE 2 STATE ----------
  const m2 = {
    groups: [],       // [{id, name, drawn, order_seq}]
    noMap: [],        // [{id, no, name}] konfigurasi NO dari admin
  };

  // ---------- CONFIG CHECK ----------
  function showSetupError(){
    statusMsg.textContent = 'Konfigurasi Supabase belum lengkap. Isi js/config.js terlebih dahulu.';
    drawBtn.disabled = true;
    applyMaxBtn.disabled = true;
    saveGroupsBtn.disabled = true;
    drawGroupBtn.disabled = true;
    console.error('Supabase tidak terkonfigurasi: isi SUPABASE_URL dan SUPABASE_ANON_KEY di js/config.js');
  }

  // ---------- REEL BUILD ----------
  function digitCount(){ return String(state.total).length; }

  function buildReel(){
    reelRow.innerHTML = '';
    const cols = digitCount();
    for(let c=0;c<cols;c++){
      const col = document.createElement('div');
      col.className = 'reel-col';
      const strip = document.createElement('div');
      strip.className = 'reel-strip';
      // 0-9 repeated 8 times
      for(let r=0;r<8;r++){
        for(let d=0; d<10; d++){
          const div = document.createElement('div');
          div.className = 'reel-digit';
          div.textContent = d;
          strip.appendChild(div);
        }
      }
      col.appendChild(strip);
      reelRow.appendChild(col);
    }
    setDisplay('0'.repeat(cols), false);
  }

  function setDisplay(str, animate, onDone){
    const strips = reelRow.querySelectorAll('.reel-strip');
    const digitH = strips[0].firstChild.getBoundingClientRect().height;
    let finished = 0;
    const total = strips.length;
    strips.forEach((strip, i)=>{
      const digit = parseInt(str[i], 10);
      const targetIndex = 70 + digit; // land within last loop
      const y = -(targetIndex * digitH);
      if(!animate){
        strip.style.transition = 'none';
        strip.style.transform = `translateY(${y}px)`;
        return;
      }
      // reset instantly to a starting point near top so it has room to spin
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0px)';
      // force reflow
      void strip.offsetHeight;
      const duration = 1.6 + i * 0.55; // leftmost stops last
      strip.style.transition = `transform ${duration}s cubic-bezier(0.12,0.85,0.2,1)`;
      strip.style.transform = `translateY(${y}px)`;
      const handler = ()=>{
        strip.removeEventListener('transitionend', handler);
        finished++;
        if(finished === total && onDone) onDone();
      };
      strip.addEventListener('transitionend', handler);
    });
  }

  // ---------- STATUS / HISTORY / ADMIN META ----------
  function refreshMeta(){
    maxDrawInput.value = state.total;
    remainingCountEl.textContent = state.remaining.length;
    drawnCountEl.textContent = state.history.length;
    drawBtn.disabled = state.remaining.length === 0;
    statusMsg.textContent = state.remaining.length === 0 ? 'Semua nomor sudah diundi.' : '';
    renderHistory();
  }

  function renderHistory(){
    historyList.innerHTML = '';
    state.history.slice().reverse().forEach(n=>{
      const li = document.createElement('li');
      li.textContent = String(n).padStart(digitCount(),'0');
      historyList.appendChild(li);
    });
  }

  // ---------- CONFETTI ----------
  function confettiBurst(){
    const colors = ['#e8b54d','#5fb98a','#e4572e','#f6efe0','#7fd1c9'];
    for(let i=0;i<36;i++){
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = Math.random()*100 + 'vw';
      p.style.background = colors[Math.floor(Math.random()*colors.length)];
      const rot = (Math.random()*720-360) + 'deg';
      p.style.setProperty('--rot', rot);
      const dur = 1.8 + Math.random()*1.4;
      p.style.animation = `fall ${dur}s ease-in forwards`;
      document.body.appendChild(p);
      setTimeout(()=>p.remove(), dur*1000+50);
    }
  }

  // ---------- DRAW LOGIC ----------
  drawBtn.addEventListener('click', async ()=>{
    if(spinning || state.remaining.length===0) return;
    spinning = true;
    drawBtn.disabled = true;
    statusMsg.textContent = 'Mengocok...';
    try{
      const { data, error } = await supabase.rpc('draw_next');
      if (error) throw new Error(error.message);
      if(!data){
        await loadState();
        refreshMeta();
        return; // pool habis
      }
      const target = data;
      const str = String(target).padStart(digitCount(),'0');
      setDisplay(str, true, async ()=>{
        confettiBurst();
        statusMsg.textContent = `Nomor urut ${str} terpilih!`;
        try{
          await loadState();
        }catch(e){ console.error(e); }
        spinning = false;
        refreshMeta();
        renderAdminPool();
        renderAdminQueue();
      });
    }catch(e){
      console.error(e);
      spinning = false;
      statusMsg.textContent = 'Gagal melakukan undian: ' + e.message;
      refreshMeta();
    }
  });

  // ---------- HIDDEN ADMIN ACCESS ----------
  let tapCount = 0, tapTimer = null;
  secretDot.addEventListener('click', ()=>{
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(()=>{ tapCount = 0; }, 2500);
    if(tapCount >= 6){
      tapCount = 0;
      openPinPrompt();
    }
  });

  function openPinPrompt(){
    if(!pinOverlay || !pinInput) return;
    pinInput.value = '';
    pinError.textContent = '';
    pinOverlay.classList.add('show');
    setTimeout(()=>pinInput.focus(), 50);
  }
  function closePinPrompt(){
    if(pinOverlay) pinOverlay.classList.remove('show');
  }

  if(pinOverlay){
    pinCancelBtn.addEventListener('click', closePinPrompt);
    pinInput.addEventListener('keydown', e=>{ if(e.key==='Enter') pinSubmitBtn.click(); });
    pinSubmitBtn.addEventListener('click', async ()=>{
      pinSubmitBtn.disabled = true;
      try{
        const { data, error } = await supabase.rpc('login', { pin_input: pinInput.value });
        if (error) throw new Error(error.message);
        if(data){
          closePinPrompt();
          await openAdmin();
        } else {
          pinError.textContent = 'PIN salah.';
        }
      }catch(e){
        console.error(e);
        pinError.textContent = 'Gagal memvalidasi PIN. Coba lagi.';
      }finally{
        pinSubmitBtn.disabled = false;
      }
    });
  }

  // ---------- UNDIAN MAKSIMAL (tampilan utama) ----------
  applyMaxBtn.addEventListener('click', async ()=>{
    const n = parseInt(maxDrawInput.value, 10);
    if(!n || n < 1) return;
    if(n === state.total) return;
    if(state.history.length > 0){
      const ok = await askConfirm({
        title: 'Ubah Undian Maksimal',
        message: `Ubah undian maksimal menjadi ${n}? Seluruh ${state.history.length} riwayat undian saat ini akan terhapus.`,
        okLabel: 'Ubah',
      });
      if(!ok){
        maxDrawInput.value = state.total;
        return;
      }
    }
    applyMaxBtn.disabled = true;
    try{
      const { error } = await supabase.rpc('reset_pool', { new_total: n });
      if (error) throw new Error(error.message);
      await loadState();
      buildReel();
      refreshMeta();
      renderAdminPool();
      renderAdminQueue();
    }catch(e){
      console.error(e);
      alert('Gagal menyimpan pengaturan: ' + e.message);
      maxDrawInput.value = state.total;
    }finally{
      applyMaxBtn.disabled = false;
    }
  });

  // ---------- RESET UNDIAN ----------
  resetBtn.addEventListener('click', async ()=>{
    if(state.remaining.length === state.total && state.history.length === 0 && state.overrideQueue.length === 0) return;
    const ok = await askConfirm({
      title: 'Reset Undian',
      message: `Kembalikan undian ke awal? Seluruh ${state.history.length} riwayat, ${state.overrideQueue.length} antrian admin, dan ${state.total - state.remaining.length} nomor terpakai akan dihapus.`,
      okLabel: 'Reset Undian',
    });
    if(!ok) return;
    resetBtn.disabled = true;
    try{
      const { error } = await supabase.rpc('reset_pool', { new_total: state.total });
      if (error) throw new Error(error.message);
      await loadState();
      buildReel();
      refreshMeta();
      renderAdminPool();
      renderAdminQueue();
      statusMsg.textContent = 'Undian direset ke awal.';
    }catch(e){
      console.error(e);
      alert('Gagal mereset undian: ' + e.message);
    }finally{
      resetBtn.disabled = false;
    }
  });

  // ---------- ADMIN PANEL ----------
  async function openAdmin(){
    if(!adminOverlay) return;
    try{
      await Promise.all([loadGroups(), loadNoMap()]);
      refreshGroupViews();
    }catch(e){
      console.warn('Data Mode 2 gagal dimuat ulang:', e.message);
    }
    renderAdminPool();
    renderAdminQueue();
    renderGroupsForceInput();
    renderGroupsAdmin();
    renderNoMap();
    adminOverlay.classList.add('show');
  }
  if(adminOverlay){
    closeAdminBtn.addEventListener('click', ()=>adminOverlay.classList.remove('show'));
    logoutBtn.addEventListener('click', ()=>{
      adminOverlay.classList.remove('show');
      pinOverlay.classList.add('show');
      pinInput.value = '';
      pinError.textContent = '';
      pinSubmitBtn.disabled = false;
    });
  }

  function renderAdminPool(){
    if(!poolGrid) return;
    poolGrid.innerHTML = '';
    state.remaining.slice().sort((a,b)=>a-b).forEach(n=>{
      const chip = document.createElement('div');
      chip.className = 'pool-chip';
      chip.textContent = String(n).padStart(digitCount(),'0');
      poolGrid.appendChild(chip);
    });
  }

  if(adminOverlay){
    overrideInput.addEventListener('keydown', e=>{ if(e.key==='Enter') addOverrideBtn.click(); });
    addOverrideBtn.addEventListener('click', async ()=>{
      const raw = overrideInput.value.trim();
      if(!raw) return;
      const parts = raw.split(/[,\s]+/).filter(Boolean);
      const added = [];
      const skipped = [];
      parts.forEach(p=>{
        const n = parseInt(p, 10);
        if(!n || n < 1 || n > state.total){
          skipped.push(p);
          return;
        }
        if(state.overrideQueue.some(q=>q.number === n)){
          skipped.push(p);
          return;
        }
        added.push(n);
      });
      if(added.length === 0){
        if(skipped.length) alert(`Dilewati (di luar 1-${state.total} atau sudah di antrian): ${skipped.join(', ')}`);
        return;
      }
      addOverrideBtn.disabled = true;
      try{
        const { error } = await supabase.rpc('add_override', { nums: added });
        if (error) throw new Error(error.message);
        await loadState();
        renderAdminQueue();
        if(skipped.length){
          alert(`Ditambahkan: ${added.join(', ')}\nDilewati (di luar 1-${state.total} atau sudah di antrian): ${skipped.join(', ')}`);
        }
      }catch(e){
        console.error(e);
        alert('Gagal menambah antrian: ' + e.message);
      }finally{
        addOverrideBtn.disabled = false;
      }
      overrideInput.value = '';
    });
  }

  function renderAdminQueue(){
    if(!overrideList) return;
    overrideList.innerHTML = '';
    if(state.overrideQueue.length === 0){
      const p = document.createElement('p');
      p.className = 'small-note';
      p.textContent = 'Belum ada nomor yang diatur — mode saat ini acak murni.';
      overrideList.appendChild(p);
      return;
    }
    state.overrideQueue.forEach((q, i)=>{
      const row = document.createElement('div');
      row.className = 'queue-item';
      const inPool = state.remaining.includes(q.number);
      row.innerHTML = `<span><span class="pos">Undian ke-${state.history.length + i + 1}</span>${String(q.number).padStart(digitCount(),'0')}${inPool ? '' : ' (tidak tersedia)'}</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Hapus';
      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        try{
          const { error } = await supabase.rpc('remove_override', { p_seq: q.seq });
          if (error) throw new Error(error.message);
          await loadState();
          renderAdminQueue();
          renderAdminPool();
        }catch(e){
          console.error(e);
          alert('Gagal menghapus antrian: ' + e.message);
          btn.disabled = false;
        }
      });
      row.appendChild(btn);
      overrideList.appendChild(row);
    });
  }

  if(adminOverlay){
    savePinBtn.addEventListener('click', async ()=>{
      const v = newPinInput.value.trim();
      if(v.length < 4){
        alert('Gunakan PIN minimal 4 karakter.');
        return;
      }
      savePinBtn.disabled = true;
      try{
        const { error } = await supabase.rpc('set_pin', { new_pin: v });
        if (error) throw new Error(error.message);
        newPinInput.value = '';
        alert('PIN admin diperbarui.');
      }catch(e){
        console.error(e);
        alert('Gagal menyimpan PIN: ' + e.message);
      }finally{
        savePinBtn.disabled = false;
      }
    });
  }

  // ---------- MODE 2: UNDIAN GRUP ----------
  function setMode(m){
    document.getElementById('mode1').classList.toggle('active', m === 1);
    document.getElementById('mode2').classList.toggle('active', m === 2);
    mode1Tab.classList.toggle('active', m === 1);
    mode2Tab.classList.toggle('active', m === 2);
  }
  mode1Tab.addEventListener('click', ()=>setMode(1));
  mode2Tab.addEventListener('click', ()=>setMode(2));

  function esc(s){
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  async function loadGroups(){
    const { data, error } = await supabase.rpc('get_groups');
    if (error) throw new Error(error.message);
    m2.groups = data;
  }

  function renderGroupChips(el){
    const target = el || groupChips;
    target.innerHTML = '';
    m2.groups.forEach(g=>{
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = g.name + (g.drawn ? ' ✓' : '');
      target.appendChild(s);
    });
  }
  function refreshGroupViews(){
    renderGroupChips();
    renderGroupHistory();
    renderGroupsAdmin();
    renderGroupsForceInput();
    renderNoMap();
  }

  // ---------- KONFIGURASI NO GRUP (ADMIN) ----------
  async function loadNoMap(){
    const { data, error } = await supabase.rpc('get_group_no_map');
    if (error) throw new Error(error.message);
    m2.noMap = data;
  }
  function noForGroup(name){
    const key = String(name).trim().toLowerCase();
    const e = m2.noMap.find(x=>String(x.name).trim().toLowerCase() === key);
    return e ? e.no : null;
  }
  function renderNoMap(){
    if(!noMapBody) return;
    noMapBody.innerHTML = '';
    m2.noMap.forEach((e, i)=>{
      const tr = document.createElement('tr');
      const tdNo = document.createElement('td');
      const no = document.createElement('input');
      no.type = 'number';
      no.min = '1';
      no.value = e.no;
      no.dataset.row = i;
      no.className = 'noMapNo';
      tdNo.appendChild(no);
      const tdName = document.createElement('td');
      const name = document.createElement('input');
      name.type = 'text';
      name.value = e.name;
      name.dataset.row = i;
      name.className = 'noMapName';
      tdName.appendChild(name);
      const tdDel = document.createElement('td');
      tdDel.className = 'del';
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = ()=>tr.remove();
      tdDel.appendChild(del);
      tr.append(tdNo, tdName, tdDel);
      noMapBody.appendChild(tr);
    });
  }
  function addNoMapRow(){
    if(!noMapBody) return;
    const tr = document.createElement('tr');
    const tdNo = document.createElement('td');
    const no = document.createElement('input');
    no.type = 'number';
    no.min = '1';
    no.value = '';
    tdNo.appendChild(no);
    const tdName = document.createElement('td');
    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'Nama grup';
    tdName.appendChild(name);
    const tdDel = document.createElement('td');
    tdDel.className = 'del';
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = ()=>tr.remove();
    tdDel.appendChild(del);
    tr.append(tdNo, tdName, tdDel);
    noMapBody.appendChild(tr);
    name.focus();
  }
  function collectNoMap(){
    return [...noMapBody.querySelectorAll('tr')].map(tr=>{
      const no = parseInt(tr.querySelector('.noMapNo')?.value, 10);
      const name = (tr.querySelector('.noMapName')?.value || '').trim();
      return { no: isFinite(no) ? no : null, name };
    }).filter(r=>r.name);
  }
  if(adminOverlay){
    addNoMapRowBtn.addEventListener('click', addNoMapRow);
    saveNoMapBtn.addEventListener('click', async ()=>{
      saveNoMapBtn.disabled = true;
      try{
        const rows = collectNoMap();
        const { error } = await supabase.rpc('save_group_no_map', { rows });
        if (error) throw new Error(error.message);
        await loadNoMap();
        renderNoMap();
        renderGroupHistory();
        groupStatusMsg.textContent = `Nomor urut tersimpan: ${m2.noMap.length} entri.`;
      }catch(e){
        console.error(e);
        alert('Gagal menyimpan nomor urut: ' + e.message);
      }finally{
        saveNoMapBtn.disabled = false;
      }
    });
  }

  function saveGroupsFlow(srcBtn, srcInput, msg){
    const names = srcInput.value.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!names.length) return Promise.resolve();
    srcBtn.disabled = true;
    return supabase.rpc('save_groups', { names })
      .then(async ({ error })=>{
        if (error) throw new Error(error.message);
        await loadGroups();
        refreshGroupViews();
        groupStatusMsg.textContent = msg + ` — tersimpan ${m2.groups.length} grup.`;
      })
      .finally(()=>{ srcBtn.disabled = false; });
  }

  saveGroupsBtn.addEventListener('click', ()=>{
    saveGroupsFlow(saveGroupsBtn, groupInput, 'Simpan Grup')
      .catch(e=>{
        console.error(e);
        alert('Gagal menyimpan grup: ' + e.message);
      });
  });

  function showGroupResult(g){
    groupResult.classList.add('show');
    groupResult.innerHTML = '';
    if(g.order){
      const orderEl = document.createElement('div');
      orderEl.className = 'grp-order';
      orderEl.textContent = 'Undian ke-' + g.order;
      groupResult.appendChild(orderEl);
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'grp-name';
    nameEl.textContent = g.name;
    groupResult.appendChild(nameEl);
  }

  function addGroupHistory(g){
    const row = document.createElement('div');
    row.className = 'hist-group';
    const orderHtml = g.order ? `<div class="hg-order">Undian ke-${g.order}</div>` : '';
    row.innerHTML = `${orderHtml}<div class="hg-name">${esc(g.name)}</div>`;
    groupHistory.prepend(row);
  }
  function renderGroupHistory(){
    groupHistory.innerHTML = '';
    m2.groups
      .filter(g=>g.drawn)
      .slice()
      .sort((a,b)=>(a.order_seq || 0) - (b.order_seq || 0))
      .forEach(g=>{
        addGroupHistory(Object.assign({}, g, { order: noForGroup(g.name) || g.order_seq }));
      });
  }

  function playSlotRoll(finalName){
    return new Promise(resolve=>{
      const pool = (m2.groups.length ? m2.groups.map(g=>g.name) : []).filter(Boolean);
      const base = pool.length ? pool : [finalName];
      function pick(){ return base[Math.floor(Math.random() * base.length)]; }
      groupResult.classList.add('show');
      groupResult.innerHTML =
        '<div class="grp-rolling-hint">Mengocok undian grup...</div>' +
        '<div class="slot-machine">' +
          '<div class="slot-reel"><div class="slot-strip"></div></div>' +
          '<div class="slot-reel"><div class="slot-strip"></div></div>' +
          '<div class="slot-reel"><div class="slot-strip"></div></div>' +
        '</div>';
      const stripEls = [...groupResult.querySelectorAll('.slot-strip')];
      const ITEM = 54;
      function spin(strip, arr, delay, duration){
        return new Promise(res=>{
          setTimeout(()=>{
            strip.innerHTML = '';
            arr.forEach(nm=>{
              const d = document.createElement('div');
              d.className = 'slot-item';
              d.textContent = nm;
              strip.appendChild(d);
            });
            strip.classList.add('moving');
            const total = ITEM * (arr.length - 1);
            const start = performance.now();
            function step(now){
              const p = Math.min((now - start) / duration, 1);
              const e = 1 - Math.pow(1 - p, 3);
              strip.style.transform = 'translateY(' + (-e * total) + 'px)';
              if(p < 1) requestAnimationFrame(step);
              else{
                strip.classList.remove('moving');
                res();
              }
            }
            requestAnimationFrame(step);
          }, delay);
        });
      }
      const arr1 = Array.from({ length: 26 }, pick);
      const arr2 = Array.from({ length: 26 }, pick);
      const arr3 = Array.from({ length: 26 }, pick);
      arr3.push(finalName);
      Promise.all([
        spin(stripEls[0], arr1, 0,   1500),
        spin(stripEls[1], arr2, 220, 1750),
        spin(stripEls[2], arr3, 440, 2000),
      ]).then(()=>{
        setTimeout(resolve, 650);
      });
    });
  }

  drawGroupBtn.addEventListener('click', async ()=>{
    if(drawingGroup) return;
    drawingGroup = true;
    drawGroupBtn.disabled = true;
    groupStatusMsg.textContent = 'Mengocok...';
    try{
      if(m2.groups.length === 0){
        groupStatusMsg.textContent = 'Belum ada grup — input nama grup dulu.';
        return;
      }
      const { data, error } = await supabase.rpc('draw_group');
      if (error) throw new Error(error.message);
      if(data.done){
        groupStatusMsg.textContent = 'Semua grup sudah diundi.';
        return;
      }
      await playSlotRoll(data.name);
      const no = noForGroup(data.name) || data.order;
      showGroupResult(Object.assign({}, data, { order: no }));
      addGroupHistory(Object.assign({}, data, { order: no }));
      await loadGroups();
      refreshGroupViews();
      confettiBurst();
      groupStatusMsg.textContent = '';
    }catch(e){
      console.error(e);
      groupStatusMsg.textContent = 'Gagal mengocok grup: ' + e.message;
    }finally{
      drawingGroup = false;
      drawGroupBtn.disabled = false;
    }
  });

  function askConfirm(opts){
    return new Promise(resolve=>{
      confirmTitle.textContent = opts.title;
      confirmMsg.textContent = opts.message;
      confirmOkBtn.textContent = opts.okLabel || 'Ya';
      function close(){
        confirmOverlay.classList.remove('show');
        confirmOverlay.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
      }
      function onBackdrop(e){
        if(e.target === confirmOverlay){ close(); resolve(false); }
      }
      function onKey(e){
        if(e.key === 'Escape'){ close(); resolve(false); }
        else if(e.key === 'Enter'){ close(); resolve(true); }
      }
      confirmOkBtn.onclick = ()=>{ close(); resolve(true); };
      confirmCancelBtn.onclick = ()=>{ close(); resolve(false); };
      confirmOverlay.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      confirmOverlay.classList.add('show');
      confirmOkBtn.focus();
    });
  }

  async function resetGroupDraw(srcBtn){
    if(srcBtn) srcBtn.disabled = true;
    const ok = await askConfirm({
      title: 'Reset Undian Grup',
      message: 'Semua grup kembali belum diundi dan nomor urut dihapus. Tindakan ini tidak bisa dibatalkan.',
      okLabel: 'Reset Undian',
    });
    if(!ok){ if(srcBtn) srcBtn.disabled = false; return; }
    try{
      const { error } = await supabase.rpc('reset_group_draw');
      if (error) throw new Error(error.message);
      await loadGroups();
      renderGroupsAdmin();
      renderGroupChips();
      renderGroupHistory();
      groupResult.classList.remove('show');
      groupStatusMsg.textContent = 'Undian grup direset.';
    }catch(e){
      console.error(e);
      alert('Gagal reset undian grup: ' + e.message);
    }finally{
      if(srcBtn) srcBtn.disabled = false;
    }
  }
  if(resetGroupDrawMainBtn){
    resetGroupDrawMainBtn.addEventListener('click', ()=>resetGroupDraw(resetGroupDrawMainBtn));
  }

  async function clearGroupData(srcBtn){
    if(srcBtn) srcBtn.disabled = true;
    const ok = await askConfirm({
      title: 'Hapus Semua Data Grup',
      message: `Seluruh ${m2.groups.length} grup beserta nomor urutnya akan dihapus. Tindakan ini tidak bisa dibatalkan.`,
      okLabel: 'Hapus Data',
    });
    if(!ok){ if(srcBtn) srcBtn.disabled = false; return; }
    try{
      const { error } = await supabase.rpc('clear_group_data');
      if (error) throw new Error(error.message);
      m2.groups = [];
      m2.noMap = [];
      refreshGroupViews();
      renderGroupHistory();
      groupResult.classList.remove('show');
      groupStatusMsg.textContent = 'Data Mode 2 dihapus.';
    }catch(e){
      console.error(e);
      alert('Gagal menghapus data: ' + e.message);
    }finally{
      if(srcBtn) srcBtn.disabled = false;
    }
  }
  if(clearGroupDataMainBtn){
    clearGroupDataMainBtn.addEventListener('click', ()=>clearGroupData(clearGroupDataMainBtn));
  }

  // ---------- ADMIN MODE 2 ----------
  function groupPosition(g){
    return m2.groups.findIndex(x=>x.id === g.id) + 1;
  }
  function renderGroupsForceInput(){
    if(!groupsForceInput) return;
    const q = m2.groups
      .filter(g=>g.forceSeq != null)
      .sort((a,b)=>(a.forceSeq||0) - (b.forceSeq||0))
      .map(g=>groupPosition(g));
    groupsForceInput.value = q.join(', ');
  }

  if(adminOverlay){
    saveGroupsForceBtn.addEventListener('click', async ()=>{
      saveGroupsForceBtn.disabled = true;
      try{
        const raw = groupsForceInput.value.trim();
        const ids = [];
        const skipped = [];
        const seen = new Set();
        if(raw){
          raw.split(/[,\s]+/).filter(Boolean).forEach(part=>{
            const n = parseInt(part, 10);
            const g = m2.groups[n - 1];
            if(!g){ skipped.push(part); return; }
            if(g.drawn){ skipped.push(part); return; }
            if(seen.has(g.id)){ skipped.push(part); return; }
            seen.add(g.id);
            ids.push(g.id);
          });
        }
        const { error } = await supabase.rpc('set_groups_forced', { p_group_ids: ids });
        if (error) throw new Error(error.message);
        await loadGroups();
        renderGroupsForceInput();
        renderGroupsAdmin();
        groupStatusMsg.textContent = ids.length
          ? `Antrian undian grup disimpan: ${ids.length} grup.`
          : 'Mode acak murni (tanpa antrian).';
        if(skipped.length) alert(`Dilewati: ${skipped.join(', ')} (nomor di luar daftar, sudah diundi, atau duplikat).`);
      }catch(e){
        console.error(e);
        alert('Gagal menyimpan antrian grup: ' + e.message);
      }finally{
        saveGroupsForceBtn.disabled = false;
      }
    });
  }

  function renderGroupsAdmin(){
    if(!groupsAdmin) return;
    groupsAdmin.innerHTML = '';
    if(!m2.groups.length){
      const p = document.createElement('p');
      p.className = 'ga-empty';
      p.textContent = 'Belum ada grup — input di "Nama Grup".';
      groupsAdmin.appendChild(p);
      return;
    }
    m2.groups.forEach((g, idx)=>{
      const box = document.createElement('div');
      box.className = 'group-admin';
      const head = document.createElement('div');
      head.className = 'ga-head';
      const b = document.createElement('b');
      const num = document.createElement('span');
      num.className = 'ga-num';
      num.textContent = '#' + (idx + 1);
      head.appendChild(num);
      b.textContent = g.name;
      const st = document.createElement('span');
      st.textContent = g.drawn
        ? `diundi ke-${g.order_seq || '?'}`
        : (g.forceSeq != null ? `antrian urutan ${g.forceSeq}` : 'belum diundi');
      head.append(b, st);
      box.appendChild(head);
      groupsAdmin.appendChild(box);
    });
  }

  if(adminOverlay){
    resetGroupDrawBtn.addEventListener('click', ()=>resetGroupDraw(resetGroupDrawBtn));

    clearGroupDataBtn.addEventListener('click', ()=>clearGroupData(clearGroupDataBtn));
  }

  // ---------- INIT ----------
  if(!hasSupabase){
    showSetupError();
    return;
  }
  try{
    await loadState();
    buildReel();
    refreshMeta();
  }catch(e){
    console.error(e);
    drawBtn.disabled = true;
    applyMaxBtn.disabled = true;
    statusMsg.textContent = 'Gagal memuat data dari database. Periksa koneksi & sekema tabel/fungsi di Supabase.';
  }

  // mode 2 (best-effort; tidak mengganggu mode 1 jika sekema belum ada)
  try{
    await Promise.all([loadGroups(), loadNoMap()]);
    renderGroupChips();
    renderGroupHistory();
    renderGroupsAdmin();
    renderNoMap();
  }catch(e){
    console.warn('Data Mode 2 tidak dapat dimuat:', e.message);
    groupStatusMsg.textContent = 'Mode 2 butuh supabase-m2.sql (jalankan di SQL Editor).';
  }
})();