  // ── State ──
  let images    = [];
  let overrides = {};  // path → {width,quality,format,skip,no_path}
  let expanded  = {};  // path → bool

  // ── Elements ──
  const folderPathEl  = document.getElementById('folder-path');
  const loadBtn       = document.getElementById('load-btn');
  const browseBtn     = document.getElementById('browse-btn');
  const dropZone      = document.getElementById('drop-zone');
  const fileInput     = document.getElementById('file-input');
  const gWidth        = document.getElementById('g-width');
  const gQuality      = document.getElementById('g-quality');
  const gFormat       = document.getElementById('g-format');
  const gSuffix       = document.getElementById('g-suffix');
  const gOutfolder    = document.getElementById('g-outfolder');
  const gOverwrite    = document.getElementById('g-overwrite');
  const suffixRow     = document.getElementById('suffix-row');
  const applyAllBtn   = document.getElementById('apply-all-btn');
  const convertBtn    = document.getElementById('convert-btn');
  const selAllBtn     = document.getElementById('sel-all-btn');
  const deselAllBtn   = document.getElementById('desel-all-btn');
  const clearBtn      = document.getElementById('clear-btn');
  const expandAllBtn  = document.getElementById('expand-all-btn');
  const collapseAllBtn= document.getElementById('collapse-all-btn');
  const imageGrid     = document.getElementById('image-grid');
  const emptyState    = document.getElementById('empty-state');
  const toolbar       = document.getElementById('toolbar');
  const toolbarCount  = document.getElementById('toolbar-count');
  const resultsBar    = document.getElementById('results-bar');
  const topbarStatus  = document.getElementById('topbar-status');
  const progOverlay   = document.getElementById('prog-overlay');
  const progFill      = document.getElementById('prog-fill');
  const progSub       = document.getElementById('prog-sub');

  // ── Slider / input labels ──
  gQuality.addEventListener('input', () => {
    document.getElementById('lbl-quality').textContent = gQuality.value + '%';
  });
  gWidth.addEventListener('input', () => {
    document.getElementById('lbl-width').textContent = gWidth.value + ' px';
  });

  // ── Overwrite toggle hides suffix field ──
  gOverwrite.addEventListener('change', () => {
    suffixRow.style.opacity  = gOverwrite.checked ? '.35' : '1';
    suffixRow.style.pointerEvents = gOverwrite.checked ? 'none' : '';
  });

  // ── Drag & Drop ──
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const items = [...(e.dataTransfer.items || [])];
    const files = [...e.dataTransfer.files];
    if (!files.length) { showToast('No files detected. Drag image files from Explorer.', 'err'); return; }

    // Try to get a real filesystem path via webkitGetAsEntry
    let folderHint = '';
    if (items.length && items[0].webkitGetAsEntry) {
      const entry = items[0].webkitGetAsEntry();
      if (entry && entry.fullPath) {
        // fullPath is a virtual path like /filename.jpg — not a real OS path
        // We'll rely on the path input field as a hint
      }
    }

    handleFileList(files);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFileList([...fileInput.files]);
    fileInput.value = '';
  });

  async function handleFileList(files) {
    const imgFiles = files.filter(f => /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i.test(f.name));
    if (!imgFiles.length) { showToast('No supported image files in selection.', 'err'); return; }

    setLoading(true);
    const formData = new FormData();
    imgFiles.forEach(f => {
      formData.append('files', f);
      formData.append('paths[]', f.path || '');
    });

    try {
      const res  = await fetch('/resolve-files', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) { showToast('Error: ' + data.error, 'err'); return; }

      // Check if paths couldn't be resolved (browser security blocks real paths)
      const noPaths = data.images.filter(i => i.no_path);
      if (noPaths.length > 0) {
        // Try to resolve paths using the folder hint field
        const folderHint = folderPathEl.value.trim() || data.folder || '';
        if (folderHint) {
          const filenames = noPaths.map(i => i.name);
          try {
            const rRes  = await fetch('/resolve-paths', {
              method: 'POST', headers: {'Content-Type':'application/json'},
              body: JSON.stringify({ filenames, folder: folderHint })
            });
            const rData = await rRes.json();
            if (!rData.error && rData.resolved) {
              // Patch in real paths for images that were resolved
              data.images.forEach(img => {
                if (img.no_path && rData.resolved[img.name]) {
                  img.path    = rData.resolved[img.name];
                  img.no_path = false;
                  delete img.no_path;
                }
              });
              if (rData.folder) folderPathEl.value = rData.folder;
            }
          } catch(_) { /* ignore resolve errors, fall through */ }
        }

        // After attempted resolution, check if any still have no path
        const stillNoPaths = data.images.filter(i => i.no_path);
        if (stillNoPaths.length === data.images.length) {
          // Nothing resolved — prompt for folder
          showPathPrompt(imgFiles[0].name);
          return;
        } else if (stillNoPaths.length > 0) {
          showToast(`⚠ ${stillNoPaths.length} file(s) could not be resolved and will error on convert.`, 'err');
        }
      }

      if (data.folder) folderPathEl.value = data.folder;
      loadFromList(data.images, data.folder || folderPathEl.value || 'file picker');
    } catch(e) {
      showToast('Failed: ' + e.message, 'err');
    } finally {
      setLoading(false);
    }
  }

  function showPathPrompt(sampleFilename) {
    const msg = `Browser security prevents reading file paths from drag-and-drop.\n\nPaste the folder path containing your images into the path field below and click Load.\n\nExample: C:\\Users\\you\\Desktop\\photos`;
    const folder = prompt(msg, folderPathEl.value || '');
    if (folder && folder.trim()) {
      folderPathEl.value = folder.trim();
      loadFolder(folder.trim());
    } else {
      showToast('Paste your folder path in the field below and click Load.', 'err');
    }
  }

  // ── Browse for folder ──
  browseBtn.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      showToast('Directory picker not supported. Paste the folder path manually.', 'err');
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });

      // Collect all image file handles from the directory
      const imgExts = /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i;
      const fileHandles = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file' && imgExts.test(name)) {
          fileHandles.push(handle);
        }
      }

      if (!fileHandles.length) {
        showToast('No supported images found in that folder.', 'err');
        return;
      }

      // showDirectoryPicker does NOT expose the real OS path.
      // Ask the user to confirm/enter the full path once — pre-fill with folder name as hint.
      const existingPath = folderPathEl.value.trim();
      let folderPath = existingPath;

      // If the existing path already ends with this folder name, use it directly
      const lastName = existingPath.replace(/\\/g, '/').split('/').pop();
      if (!existingPath || lastName.toLowerCase() !== dirHandle.name.toLowerCase()) {
        folderPath = prompt(
          `Folder selected: "${dirHandle.name}"\n\nEnter the full path to this folder so images can be saved correctly:\n(e.g. C:\\Users\\you\\Desktop\\${dirHandle.name})`,
          existingPath || `C:\\Users\\${dirHandle.name}`
        );
        if (!folderPath || !folderPath.trim()) {
          showToast('No path entered — cancelled.', 'err');
          return;
        }
        folderPath = folderPath.trim();
      }

      // Verify the folder exists on the backend, then scan it
      folderPathEl.value = folderPath;
      loadFolder(folderPath);

    } catch(e) {
      if (e.name !== 'AbortError') showToast('Browse failed: ' + e.message, 'err');
    }
  });

  // ── Load by folder path ──
  loadBtn.addEventListener('click', () => {
    const p = folderPathEl.value.trim();
    if (p) loadFolder(p); else showToast('Enter a folder path first.', 'err');
  });
  folderPathEl.addEventListener('keydown', e => { if (e.key === 'Enter') loadBtn.click(); });

  async function loadFolder(path) {
    setLoading(true);
    try {
      const res  = await fetch('/scan-folder', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({folder: path})
      });
      const data = await res.json();
      if (data.error) { showToast('Error: ' + data.error, 'err'); return; }
      loadFromList(data.images, path);
    } catch(e) {
      showToast('Request failed: ' + e.message, 'err');
    } finally {
      setLoading(false);
    }
  }

  function loadFromList(imgs, label) {
    // Merge with existing — don't wipe cards already loaded
    const existingPaths = new Set(images.map(i => i.path));
    const newImgs = imgs.filter(i => !existingPaths.has(i.path));

    newImgs.forEach(img => {
      images.push(img);
      overrides[img.path] = {
        width:   parseInt(gWidth.value),
        quality: parseInt(gQuality.value),
        format:  gFormat.value,
        skip:    false,
        no_path: !!img.no_path
      };
      expanded[img.path] = false;
    });

    renderGrid();
    topbarStatus.textContent = `${images.length} image${images.length !== 1 ? 's' : ''} — ${label}`;
    showToast(`Loaded ${newImgs.length} image${newImgs.length !== 1 ? 's' : ''}`, 'ok');
    updateButtons();
  }

  function setLoading(on) {
    loadBtn.disabled    = on;
    loadBtn.textContent = on ? '…' : 'Load';
  }

  // ── Remove one image from batch ──
  function removeImage(path) {
    images = images.filter(i => i.path !== path);
    delete overrides[path];
    delete expanded[path];
    renderGrid();
    updateButtons();
    if (!images.length) topbarStatus.textContent = 'No folder loaded';
  }
  window.removeImage = removeImage;

  // ── Apply global to all ──
  applyAllBtn.addEventListener('click', () => {
    images.forEach(img => {
      overrides[img.path].width   = parseInt(gWidth.value);
      overrides[img.path].quality = parseInt(gQuality.value);
      overrides[img.path].format  = gFormat.value;
    });
    renderGrid();
    showToast('Global settings applied to all images', 'ok');
  });

  // ── Select / Deselect / Clear ──
  selAllBtn.addEventListener('click', () => {
    images.forEach(i => overrides[i.path].skip = false);
    renderGrid();
  });
  deselAllBtn.addEventListener('click', () => {
    images.forEach(i => overrides[i.path].skip = true);
    renderGrid();
  });
  clearBtn.addEventListener('click', () => {
    images = []; overrides = {}; expanded = {};
    renderGrid();
    topbarStatus.textContent = 'No folder loaded';
    resultsBar.style.display = 'none';
    updateButtons();
  });

  // ── Expand / Collapse ──
  expandAllBtn.addEventListener('click', () => {
    images.forEach(i => expanded[i.path] = true);
    renderGrid();
  });
  collapseAllBtn.addEventListener('click', () => {
    images.forEach(i => expanded[i.path] = false);
    renderGrid();
  });

  function updateButtons() {
    const has = images.length > 0;
    convertBtn.disabled  = !has;
    selAllBtn.disabled   = !has;
    deselAllBtn.disabled = !has;
    clearBtn.disabled    = !has;
  }

  // ── Render ──
  function renderGrid() {
    if (!images.length) {
      imageGrid.style.display = 'none';
      emptyState.style.display = 'flex';
      toolbar.style.display    = 'none';
      return;
    }
    emptyState.style.display = 'none';
    imageGrid.style.display  = 'grid';
    toolbar.style.display    = 'flex';
    imageGrid.innerHTML = images.map(buildCard).join('');

    images.forEach(img => {
      const id   = cardId(img.path);
      const card = document.getElementById(id);
      if (!card) return;

      card.querySelector('.skip-cb')?.addEventListener('change', function() {
        overrides[img.path].skip = this.checked;
        card.classList.toggle('is-skipped', this.checked);
        updateToolbar();
      });
      card.querySelector('.ov-width')?.addEventListener('change', function() {
        overrides[img.path].width = parseInt(this.value) || parseInt(gWidth.value);
        card.querySelector('.s-width').textContent = this.value + 'px';
      });
      card.querySelector('.ov-quality')?.addEventListener('input', function() {
        overrides[img.path].quality = parseInt(this.value);
        card.querySelector('.ov-qlabel').textContent = this.value + '%';
        card.querySelector('.s-quality').textContent = this.value + '%';
      });
      card.querySelector('.ov-format')?.addEventListener('change', function() {
        overrides[img.path].format = this.value;
        card.querySelector('.s-format').textContent = this.value;
      });
    });

    updateToolbar();
  }

  function cardId(path) {
    return 'c_' + btoa(encodeURIComponent(path)).replace(/[^a-zA-Z0-9]/g, '_');
  }

  function buildCard(img) {
    const ov  = overrides[img.path];
    const exp = expanded[img.path];
    const id  = cardId(img.path);
    const ep  = encodeURIComponent(img.path);
    const hasPath = !ov.no_path && img.path;
    const thumbSrc = hasPath ? `/preview?path=${encodeURIComponent(img.path)}` : '';

    const thumb = hasPath
      ? `<img class="card-thumb" src="${thumbSrc}" alt="${img.name}" onclick="toggleExpand('${ep}')" loading="lazy" onerror="this.outerHTML='<div class=\\'card-thumb-placeholder\\' onclick=\\'toggleExpand(\\'${ep}\\')\\'>🖼️</div>'" />`
      : `<div class="card-thumb-placeholder" onclick="toggleExpand('${ep}')">🖼️</div>`;

    return `
    <div class="img-card ${ov.skip ? 'is-skipped' : ''}" id="${id}">
      ${thumb}
      <button class="card-remove" onclick="removeImage('${img.path.replace(/'/g,"\\'")}\')" title="Remove from batch">✕</button>
      <div class="card-body">
        <div class="card-name" title="${img.name}">${img.name}</div>
        <div class="card-meta">${img.width} × ${img.height}px · ${img.size_kb} KB · ${img.format}</div>

        <div class="card-overrides" style="display:${exp ? 'flex' : 'none'}">
          <div class="ov-row">
            <label>Skip</label>
            <input type="checkbox" class="skip-cb" ${ov.skip ? 'checked' : ''} />
            <span style="font-size:11px;color:var(--text3)">Exclude from batch</span>
          </div>
          <div class="ov-row">
            <label>Width</label>
            <input type="number" class="ov-width" value="${ov.width}" min="1" max="9999" />
            <span class="input-suffix">px</span>
          </div>
          <div class="ov-row">
            <label>Quality</label>
            <input type="range" class="ov-quality" min="10" max="100" value="${ov.quality}" style="flex:1;margin:0" />
            <span class="ov-qlabel" style="font-family:var(--mono);font-size:11px;width:30px;text-align:right;color:var(--text2)">${ov.quality}%</span>
          </div>
          <div class="ov-row">
            <label>Format</label>
            <select class="ov-format">
              <option value="original" ${ov.format==='original'?'selected':''}>Original</option>
              <option value="webp"     ${ov.format==='webp'?'selected':''}>WebP</option>
              <option value="jpg"      ${ov.format==='jpg'?'selected':''}>JPG</option>
              <option value="png"      ${ov.format==='png'?'selected':''}>PNG</option>
            </select>
          </div>
        </div>

        <div class="card-footer">
          <span class="card-summary">
            <span class="s-width">${ov.width}px</span> ·
            <span class="s-quality">${ov.quality}%</span> ·
            <span class="s-format">${ov.format}</span>
          </span>
          <button class="btn btn-ghost btn-sm" onclick="toggleExpand('${ep}')">
            ${exp ? '▲ Less' : '▼ Edit'}
          </button>
        </div>
      </div>
    </div>`;
  }

  function toggleExpand(ep) {
    const path = decodeURIComponent(ep);
    expanded[path] = !expanded[path];
    renderGrid();
  }
  window.toggleExpand = toggleExpand;

  function updateToolbar() {
    const active = images.filter(i => !overrides[i.path]?.skip).length;
    toolbarCount.textContent = `${active} of ${images.length} images selected for conversion`;
  }

  // ── Convert ──
  convertBtn.addEventListener('click', async () => {
    const jobs = images.map(img => ({
      path:    img.path,
      name:    img.name,
      width:   overrides[img.path].width,
      quality: overrides[img.path].quality,
      format:  overrides[img.path].format,
      skip:    overrides[img.path].skip,
      no_path: overrides[img.path].no_path || false
    }));

    const overwriteMode = gOverwrite.checked;
    const suffix    = overwriteMode ? '' : (gSuffix.value || '-optimized');
    const outFolder = gOutfolder.value.trim();

    progOverlay.classList.add('active');
    progFill.style.width = '0%';

    let fakeP = 0;
    const ticker = setInterval(() => {
      fakeP = Math.min(fakeP + 2, 88);
      progFill.style.width = fakeP + '%';
    }, 80);

    try {
      const res  = await fetch('/convert', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({jobs, output_suffix: suffix, output_folder: outFolder, overwrite: overwriteMode})
      });
      const data = await res.json();

      clearInterval(ticker);
      progFill.style.width = '100%';
      await sleep(350);
      progOverlay.classList.remove('active');

      let ok = 0, skip = 0, err = 0;
      data.results.forEach(r => {
        if      (r.status === 'ok')      ok++;
        else if (r.status === 'skipped') skip++;
        else                             err++;

        const card = images
          .map(i => document.getElementById(cardId(i.path)))
          .find(c => c?.querySelector('.card-name')?.title === r.name);
        if (!card) return;

        card.classList.remove('is-done','is-error');
        let badge = card.querySelector('.card-badge');
        if (!badge) { badge = document.createElement('div'); badge.className = 'card-badge'; card.appendChild(badge); }

        if (r.status === 'ok')      { card.classList.add('is-done');  badge.textContent = `✓ ${r.size_kb}KB`; badge.className = 'card-badge badge-done'; }
        if (r.status === 'error')   { card.classList.add('is-error'); badge.textContent = 'error';   badge.className = 'card-badge badge-error'; }
        if (r.status === 'skipped') {                                  badge.textContent = 'skipped'; badge.className = 'card-badge badge-skipped'; }
      });

      document.getElementById('r-ok').textContent   = ok;
      document.getElementById('r-skip').textContent = skip;
      document.getElementById('r-err').textContent  = err;
      document.getElementById('r-msg').textContent  =
        overwriteMode ? 'Originals overwritten' :
        outFolder ? `Saved to ${outFolder}` : 'Saved to source folder';
      resultsBar.style.display = 'flex';

      showToast(`Done — ${ok} converted, ${skip} skipped, ${err} errors`, ok > 0 ? 'ok' : 'err');
    } catch(e) {
      clearInterval(ticker);
      progOverlay.classList.remove('active');
      showToast('Conversion failed: ' + e.message, 'err');
    }
  });

  // ── Toast ──
  let toastTimer;
  function showToast(msg, type = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }