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

  const participantInput = document.getElementById('participantInput');
  const saveParticipantsBtn = document.getElementById('saveParticipantsBtn');
  const participantChips = document.getElementById('participantChips');
  const groupInput = document.getElementById('groupInput');
  const saveGroupsBtn = document.getElementById('saveGroupsBtn');
  const groupChips = document.getElementById('groupChips');
  const drawGroupBtn = document.getElementById('drawGroupBtn');
  const groupStatusMsg = document.getElementById('groupStatusMsg');
  const groupResult = document.getElementById('groupResult');
  const groupHistory = document.getElementById('groupHistory');
  const groupsAdmin = document.getElementById('groupsAdmin');
  const resetGroupDrawBtn = document.getElementById('resetGroupDrawBtn');
  const clearGroupDataBtn = document.getElementById('clearGroupDataBtn');

  let spinning = false;
  let drawingGroup = false;

  // ---------- MODE 2 STATE ----------
  const m2 = {
    participants: [], // [{id, name}]
    groups: [],       // [{id, name, drawn, memberIds, members}]
  };

  // ---------- CONFIG CHECK ----------
  function showSetupError(){
    statusMsg.textContent = 'Konfigurasi Supabase belum lengkap. Isi js/config.js terlebih dahulu.';
    drawBtn.disabled = true;
    applyMaxBtn.disabled = true;
    saveParticipantsBtn.disabled = true;
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
          openAdmin();
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
    if(state.history.length > 0 && !confirm(`Ubah undian maksimal menjadi ${n}? Riwayat undian saat ini akan terhapus.`)) {
      maxDrawInput.value = state.total;
      return;
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
    if(!confirm(`Reset undian ke awal? Seluruh ${state.history.length} riwayat, ${state.overrideQueue.length} antrian admin, dan ${state.total - state.remaining.length} nomor terpakai akan dihapus.`)) return;
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
  function openAdmin(){
    if(!adminOverlay) return;
    renderAdminPool();
    renderAdminQueue();
    renderGroupsAdmin();
    adminOverlay.classList.add('show');
  }
  if(adminOverlay){
    closeAdminBtn.addEventListener('click', ()=>adminOverlay.classList.remove('show'));
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

  async function loadParticipants(){
    const { data, error } = await supabase.rpc('get_participants');
    if (error) throw new Error(error.message);
    m2.participants = data;
  }
  async function loadGroups(){
    const { data, error } = await supabase.rpc('get_groups');
    if (error) throw new Error(error.message);
    m2.groups = data;
  }

  function renderParticipantChips(){
    participantChips.innerHTML = '';
    m2.participants.forEach(p=>{
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = p.name;
      participantChips.appendChild(s);
    });
  }
  function renderGroupChips(){
    groupChips.innerHTML = '';
    m2.groups.forEach(g=>{
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = g.name + (g.drawn ? ' ✓' : '');
      groupChips.appendChild(s);
    });
  }

  saveParticipantsBtn.addEventListener('click', async ()=>{
    const names = participantInput.value.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!names.length) return;
    saveParticipantsBtn.disabled = true;
    try{
      const { error } = await supabase.rpc('save_participants', { names });
      if (error) throw new Error(error.message);
      participantInput.value = '';
      await loadParticipants();
      await loadGroups();
      renderParticipantChips();
      renderGroupChips();
      renderGroupHistory();
      renderGroupsAdmin();
      groupStatusMsg.textContent = `Tersimpan ${m2.participants.length} peserta.`;
    }catch(e){
      console.error(e);
      alert('Gagal menyimpan peserta: ' + e.message);
    }finally{
      saveParticipantsBtn.disabled = false;
    }
  });

  saveGroupsBtn.addEventListener('click', async ()=>{
    const names = groupInput.value.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!names.length) return;
    saveGroupsBtn.disabled = true;
    try{
      const { error } = await supabase.rpc('save_groups', { names });
      if (error) throw new Error(error.message);
      groupInput.value = '';
      await loadParticipants();
      await loadGroups();
      renderGroupChips();
      renderGroupHistory();
      renderGroupsAdmin();
      groupStatusMsg.textContent = `Tersimpan ${m2.groups.length} grup.`;
    }catch(e){
      console.error(e);
      alert('Gagal menyimpan grup: ' + e.message);
    }finally{
      saveGroupsBtn.disabled = false;
    }
  });

  function showGroupResult(g){
    groupResult.classList.add('show');
    groupResult.innerHTML = '';
    const nameEl = document.createElement('div');
    nameEl.className = 'grp-name';
    nameEl.textContent = g.name;
    groupResult.appendChild(nameEl);
    const ul = document.createElement('ul');
    if(g.members && g.members.length){
      g.members.forEach(m=>{
        const li = document.createElement('li');
        li.textContent = m;
        ul.appendChild(li);
      });
    }else{
      const li = document.createElement('li');
      li.className = 'empty-note';
      li.textContent = 'Belum ada peserta di grup ini.';
      ul.appendChild(li);
    }
    groupResult.appendChild(ul);
  }

  function addGroupHistory(g){
    const row = document.createElement('div');
    row.className = 'hist-group';
    row.innerHTML = `<div class="hg-name">${esc(g.name)}</div><div class="hg-members">${(g.members || []).map(esc).join(' · ') || '—'}</div>`;
    groupHistory.prepend(row);
  }
  function renderGroupHistory(){
    groupHistory.innerHTML = '';
    m2.groups.filter(g=>g.drawn).slice().reverse().forEach(addGroupHistory);
  }

  drawGroupBtn.addEventListener('click', async ()=>{
    if(drawingGroup) return;
    drawingGroup = true;
    drawGroupBtn.disabled = true;
    groupStatusMsg.textContent = 'Mengocok...';
    try{
      if(m2.groups.length === 0){
        // belum ada grup -> acak seluruh daftar peserta
        if(m2.participants.length === 0){
          groupStatusMsg.textContent = 'Belum ada peserta maupun grup.';
          return;
        }
        const shuffled = m2.participants.slice().sort(()=>Math.random()-0.5);
        const members = shuffled.map(p=>p.name);
        showGroupResult({ name: 'Hasil Acak (Tanpa Grup)', members });
      }else{
        const { data, error } = await supabase.rpc('draw_group');
        if (error) throw new Error(error.message);
        if(data.done){
          groupStatusMsg.textContent = 'Semua grup sudah diundi.';
          return;
        }
        showGroupResult(data);
        addGroupHistory(data);
        await loadGroups();
        renderGroupChips();
        renderGroupHistory();
        renderGroupsAdmin();
        confettiBurst();
      }
      groupStatusMsg.textContent = '';
    }catch(e){
      console.error(e);
      groupStatusMsg.textContent = 'Gagal mengocok grup: ' + e.message;
    }finally{
      drawingGroup = false;
      drawGroupBtn.disabled = false;
    }
  });

  // ---------- ADMIN MODE 2 ----------
  function renderGroupsAdmin(){
    if(!groupsAdmin) return;
    groupsAdmin.innerHTML = '';
    if(!m2.groups.length || !m2.participants.length){
      const p = document.createElement('p');
      p.className = 'ga-empty';
      p.textContent = !m2.groups.length
        ? 'Belum ada grup — input di Mode 2 → "Nama Grup".'
        : 'Belum ada peserta — input di Mode 2 → "Daftar Peserta".';
      groupsAdmin.appendChild(p);
      return;
    }
    m2.groups.forEach(g=>{
      const box = document.createElement('div');
      box.className = 'group-admin';

      const head = document.createElement('div');
      head.className = 'ga-head';
      const b = document.createElement('b');
      b.textContent = g.name;
      const st = document.createElement('span');
      st.textContent = (g.drawn ? 'sudah diundi' : 'belum diundi') + ((g.memberIds || []).length ? ` · ${g.memberIds.length} peserta` : '');
      head.append(b, st);
      box.appendChild(head);

      if(g.drawn){
        const p = document.createElement('p');
        p.className = 'ga-empty';
        p.textContent = 'Sudah diundi — reset undian grup untuk mengubah susunannya.';
        box.appendChild(p);
      }else{
        const selected = new Set(g.memberIds || []);
        const members = document.createElement('div');
        members.className = 'ga-members';
        m2.participants.forEach(p=>{
          const lab = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = p.id;
          cb.checked = selected.has(p.id);
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(p.name));
          members.appendChild(lab);
        });
        box.appendChild(members);

        const row = document.createElement('div');
        row.className = 'row';
        row.style.marginTop = '10px';
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.textContent = 'Simpan Peserta Grup';
        btn.addEventListener('click', async ()=>{
          const ids = [...members.querySelectorAll('input:checked')].map(i=>parseInt(i.value, 10));
          btn.disabled = true;
          try{
            const { error } = await supabase.rpc('set_group_participants', { p_group_id: g.id, p_participant_ids: ids });
            if (error) throw new Error(error.message);
            await loadGroups();
            renderGroupsAdmin();
            renderGroupChips();
            alert(`Peserta grup "${g.name}" disimpan (${ids.length} orang).`);
          }catch(e){
            console.error(e);
            alert('Gagal menyimpan pengaturan grup: ' + e.message);
            btn.disabled = false;
          }
        });
        row.appendChild(btn);
        box.appendChild(row);
      }
      groupsAdmin.appendChild(box);
    });
  }

  if(adminOverlay){
    resetGroupDrawBtn.addEventListener('click', async ()=>{
      if(!confirm('Reset undian grup? Semua anggota hasil undian dihapus dan semua grup kembali belum diundi.')) return;
      resetGroupDrawBtn.disabled = true;
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
        resetGroupDrawBtn.disabled = false;
      }
    });

    clearGroupDataBtn.addEventListener('click', async ()=>{
      if(!confirm('Hapus semua data Mode 2 (peserta, grup, anggota)?')) return;
      clearGroupDataBtn.disabled = true;
      try{
        const { error } = await supabase.rpc('clear_group_data');
        if (error) throw new Error(error.message);
        m2.participants = [];
        m2.groups = [];
        renderParticipantChips();
        renderGroupChips();
        renderGroupHistory();
        renderGroupsAdmin();
        groupResult.classList.remove('show');
        groupStatusMsg.textContent = 'Data Mode 2 dihapus.';
      }catch(e){
        console.error(e);
        alert('Gagal menghapus data: ' + e.message);
      }finally{
        clearGroupDataBtn.disabled = false;
      }
    });
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
    await Promise.all([loadParticipants(), loadGroups()]);
    renderParticipantChips();
    renderGroupChips();
    renderGroupHistory();
  }catch(e){
    console.warn('Data Mode 2 tidak dapat dimuat:', e.message);
    groupStatusMsg.textContent = 'Mode 2 butuh supabase-m2.sql (jalankan di SQL Editor).';
  }
})();