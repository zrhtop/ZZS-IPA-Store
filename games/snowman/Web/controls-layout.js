(() => {
  'use strict';
  const storageKey = 'snowman.controlLayout.v1';
  const area = document.getElementById('play-area');
  const buttons = Array.from(document.querySelectorAll('.control[data-control]'));
  const byID = new Map(buttons.map(button => [button.dataset.control, button]));
  const editor = document.getElementById('layout-editor');
  const slider = document.getElementById('control-size');
  const sizeOutput = document.getElementById('control-size-value');
  const selectedName = document.getElementById('selected-control-name');
  let saved = readSaved(), draft = null, editing = false, selected = '39', drag = null, wasActive = true;
  const copy = value => value ? JSON.parse(JSON.stringify(value)) : null;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function validate(value) {
    if (!value || value.version !== 1 || !value.buttons || typeof value.buttons !== 'object') return null;
    const result = {version:1, buttons:{}};
    for (const [id, item] of Object.entries(value.buttons)) {
      if (!byID.has(id) || !item || !['x','y','size'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))) return null;
      if (item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1 || item.size < 44 || item.size > 120) return null;
      result.buttons[id] = {x:item.x, y:item.y, size:item.size};
    }
    return result;
  }
  function readSaved() {
    try {
      if ('SnowmanSavedControlLayout' in window) return validate(window.SnowmanSavedControlLayout);
      return validate(JSON.parse(localStorage.getItem(storageKey)));
    } catch { return null; }
  }
  function defaults() {
    const previous = buttons.map(button => [button, button.classList.contains('layout-positioned'), button.style.cssText]);
    for (const [button] of previous) { button.classList.remove('layout-positioned'); button.removeAttribute('style'); }
    const rect = area.getBoundingClientRect();
    const result = {version:1, buttons:{}};
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect();
      result.buttons[button.dataset.control] = {
        x:(bounds.left + bounds.width / 2 - rect.left) / rect.width,
        y:(bounds.top + bounds.height / 2 - rect.top) / rect.height,
        size:clamp(bounds.width,44,120)
      };
    }
    for (const [button, positioned, style] of previous) {
      button.style.cssText = style;
      button.classList.toggle('layout-positioned',positioned);
    }
    return result;
  }
  function place(layout) {
    const rect = area.getBoundingClientRect();
    for (const button of buttons) {
      const item = layout && layout.buttons[button.dataset.control];
      button.classList.toggle('layout-positioned',Boolean(item));
      if (!item) { button.removeAttribute('style'); continue; }
      const size = item.size;
      const left = clamp(item.x * rect.width - size / 2,0,Math.max(0,rect.width - size));
      const top = clamp(item.y * rect.height - size / 2,0,Math.max(0,rect.height - size));
      button.style.left = (rect.left + left) + 'px';
      button.style.top = (rect.top + top) + 'px';
      button.style.width = size + 'px';
      button.style.height = size + 'px';
      button.style.setProperty('--control-size',size + 'px');
    }
  }
  function select(id) {
    selected = id;
    for (const button of buttons) button.classList.toggle('layout-selected',editing && button.dataset.control === id);
    for (const option of editor.querySelectorAll('[data-select-control]')) {
      option.setAttribute('aria-pressed',String(option.dataset.selectControl === id));
    }
    selectedName.textContent = byID.get(id).getAttribute('aria-label');
    slider.value = String(Math.round(draft.buttons[id].size));
    sizeOutput.value = slider.value + ' px';
  }
  function finishDrag() {
    if (!drag) return;
    const current = drag;drag = null;
    try { current.button.releasePointerCapture(current.pointerID); } catch {}
  }
  function open() {
    if (editing) return;
    const host = window.SnowmanHost;
    wasActive = host ? host.getDiagnostics().active : true;
    draft = defaults();
    if (saved) Object.assign(draft.buttons,copy(saved.buttons));
    editing = true;
    document.body.classList.add('editing-controls');
    editor.hidden = false;
    host && host.setActive(false);
    place(draft);select(selected);
  }
  function finish(commit) {
    if (!editing) return;
    finishDrag();
    if (commit) {
      saved = validate(draft);
      persist(saved);
    }
    editing = false;draft = null;editor.hidden = true;
    document.body.classList.remove('editing-controls');
    for (const button of buttons) button.classList.remove('layout-selected');
    place(saved);
    if (window.SnowmanHost) window.SnowmanHost.setActive(wasActive && !document.hidden);
  }
  function persist(layout) {
    try { if (layout) localStorage.setItem(storageKey,JSON.stringify(layout)); else localStorage.removeItem(storageKey); } catch {}
    if ('SnowmanSavedControlLayout' in window) window.SnowmanSavedControlLayout = copy(layout);
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.snowman;
    if (native) native.postMessage({type:'controls-layout',layout:copy(layout)});
  }
  function resizeSelected(value) {
    if (!editing) return;
    draft.buttons[selected].size = clamp(Number(value),44,120);
    place(draft);select(selected);
  }
  for (const button of buttons) {
    button.addEventListener('pointerdown',event => {
      if (!editing) return;
      event.preventDefault();event.stopImmediatePropagation();
      if (drag) return;
      const id = button.dataset.control;
      select(id);
      const bounds = button.getBoundingClientRect();
      drag = {button,id,pointerID:event.pointerId,offsetX:event.clientX - bounds.left - bounds.width / 2,offsetY:event.clientY - bounds.top - bounds.height / 2};
      try { button.setPointerCapture(event.pointerId); } catch {}
    });
    button.addEventListener('pointermove',event => {
      if (!editing || !drag || event.pointerId !== drag.pointerID) return;
      event.preventDefault();event.stopImmediatePropagation();
      const rect = area.getBoundingClientRect(), item = draft.buttons[drag.id], half = item.size / 2;
      item.x = clamp(event.clientX - rect.left - drag.offsetX,half,rect.width - half) / rect.width;
      item.y = clamp(event.clientY - rect.top - drag.offsetY,half,rect.height - half) / rect.height;
      place(draft);
    });
    for (const name of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(name,event => {
      if (!editing || !drag || event.pointerId !== drag.pointerID) return;
      event.preventDefault();event.stopImmediatePropagation();finishDrag();
    });
  }
  for (const option of editor.querySelectorAll('[data-select-control]')) option.addEventListener('click',() => select(option.dataset.selectControl));
  slider.addEventListener('input',() => resizeSelected(slider.value));
  document.getElementById('control-smaller').addEventListener('click',() => resizeSelected(draft.buttons[selected].size - 4));
  document.getElementById('control-larger').addEventListener('click',() => resizeSelected(draft.buttons[selected].size + 4));
  document.getElementById('save-layout').addEventListener('click',() => finish(true));
  document.getElementById('cancel-layout').addEventListener('click',() => finish(false));
  document.getElementById('reset-layout').addEventListener('click',() => { draft = defaults();place(draft);select(selected); });
  document.getElementById('reset-selected-position').addEventListener('click',() => {
    const original = defaults().buttons[selected];
    draft.buttons[selected].x = original.x;draft.buttons[selected].y = original.y;
    place(draft);select(selected);
  });
  document.addEventListener('keydown',event => { if (editing && event.key === 'Escape') finish(false); });
  window.addEventListener('blur',finishDrag);
  window.addEventListener('resize',() => place(editing ? draft : saved));
  if (window.ResizeObserver) new ResizeObserver(() => place(editing ? draft : saved)).observe(area);
  window.SnowmanControlLayout = {open,isEditing:() => editing,getSaved:() => copy(saved)};
  place(saved);
})();
