/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/* eslint-disable */

/**
 * Runs inside every preview page (injected by the preview proxy). Talks only to the AgentRoom UI
 * (window.parent) via postMessage: reports console/network/navigation, executes bot commands,
 * draws the bot's cursor, and powers the element picker. Serialized with Function#toString,
 * so it must stay self-contained.
 */
function agentroomBridge() {
  const w = window as any;
  if (w.__agentroomBridge || window.parent === window) return;
  w.__agentroomBridge = true;

  const post = (msg: Record<string, unknown>) => {
    try { window.parent.postMessage({ __agentroom: true, ...msg }, '*'); } catch {}
  };
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const fmt = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const line = (level: string, text: string) => post({ type: 'console', line: { level, text: clip(text, 2000), ts: Date.now() } });

  // ---------- console + errors + failed requests ----------
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level];
    console[level] = function (this: unknown, ...args: unknown[]) {
      line(level, args.map(fmt).join(' '));
      return orig.apply(this, args as any);
    };
  }
  addEventListener('error', (e) => line('error', `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  addEventListener('unhandledrejection', (e) => line('error', `Unhandled rejection: ${fmt((e as PromiseRejectionEvent).reason)}`));

  const origFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    try {
      const res = await origFetch.call(this, input as any, init);
      if (!res.ok) line('network', `${res.status} ${method} ${url}`);
      return res;
    } catch (err) {
      line('network', `failed ${method} ${url}: ${fmt(err)}`);
      throw err;
    }
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __ar?: string }, method: string, url: string | URL, ...rest: any[]) {
    this.__ar = `${method.toUpperCase()} ${url}`;
    this.addEventListener('loadend', () => {
      if (this.status === 0 || this.status >= 400) line('network', `${this.status || 'failed'} ${this.__ar}`);
    });
    return (xhrOpen as any).call(this, method, url, ...rest);
  } as any;

  // ---------- navigation reporting ----------
  const here = () => location.pathname + location.search + location.hash;
  const ready = () => post({ type: 'ready', path: here(), title: document.title });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready);
  else ready();
  addEventListener('load', ready);
  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = history[m];
    history[m] = function (this: History, ...args: any[]) {
      const r = orig.apply(this, args as any);
      setTimeout(ready, 0);
      return r;
    } as any;
  }
  addEventListener('popstate', ready);
  addEventListener('hashchange', ready);

  // ---------- refs + snapshot ----------
  let refSeq = 0;
  const refs = new Map<string, WeakRef<Element>>();
  const refOf = (el: Element) => {
    const e = el as Element & { __arRef?: string };
    if (!e.__arRef) {
      e.__arRef = `e${++refSeq}`;
      refs.set(e.__arRef, new WeakRef(el));
    }
    return e.__arRef;
  };
  const byRef = (ref: string) => {
    const el = refs.get(ref)?.deref();
    if (!el || !el.isConnected) throw new Error(`Element ${ref} is gone. Take a new browser_snapshot.`);
    return el as HTMLElement;
  };

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IFRAME', 'META', 'LINK', 'HEAD']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'textbox', 'combobox']);
  const visible = (el: Element) => {
    if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  };
  const text = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const nameOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id) ?? document.createElement('i'))).join(' ');
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return text(lab);
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel !== el) return text(parentLabel);
    return (
      el.getAttribute('placeholder') || text(el) || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || ''
    );
  };
  const roleOf = (el: Element): string | null => {
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return role;
    const tag = el.tagName;
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const t = (el as HTMLInputElement).type;
      if (t === 'hidden') return null;
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox' || t === 'radio') return t;
      return 'textbox';
    }
    if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
    if (el.hasAttribute('onclick')) return 'button';
    return null;
  };

  function snapshot(): string {
    const out: string[] = [`Page: ${document.title || '(untitled)'} — ${location.href}`];
    let size = 0;
    const MAX = 16000;
    const push = (depth: number, s: string) => {
      if (size > MAX) return;
      const l = `${'  '.repeat(Math.min(depth, 8))}- ${s}`;
      size += l.length;
      out.push(l);
    };
    const walk = (el: Element, depth: number) => {
      if (SKIP.has(el.tagName.toUpperCase()) || !visible(el)) return;
      const role = roleOf(el);
      if (role) {
        const name = clip(nameOf(el), 80);
        let extra = '';
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) extra = el.checked ? ' [checked]' : '';
          else if (el instanceof HTMLInputElement && el.type === 'password') extra = el.value ? ' value="••••"' : '';
          else if (el.value) extra = ` value="${clip(el.value, 60)}"`;
        } else if (el instanceof HTMLSelectElement) {
          extra = ` value="${clip(el.selectedOptions[0]?.text ?? '', 40)}"`;
        } else if (role === 'link') {
          extra = ` → ${clip(el.getAttribute('href') ?? '', 60)}`;
        }
        if ((el as HTMLButtonElement).disabled) extra += ' [disabled]';
        push(depth, `${role} "${name}"${extra} [ref=${refOf(el)}]`);
        if (role !== 'combobox' && role !== 'textbox' && el.children.length && !text(el)) for (const c of el.children) walk(c, depth + 1);
        return;
      }
      const tag = el.tagName;
      if (/^H[1-6]$/.test(tag)) {
        push(depth, `heading "${clip(text(el), 120)}" [level=${tag[1]}]`);
        return;
      }
      if (tag === 'IMG') {
        const alt = el.getAttribute('alt');
        if (alt) push(depth, `img "${clip(alt, 80)}"`);
        return;
      }
      // Own text (not from children elements).
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) own += n.textContent;
      own = own.replace(/\s+/g, ' ').trim();
      if (own) push(depth, `text "${clip(own, 200)}"`);
      const nextDepth = ['MAIN', 'NAV', 'FORM', 'SECTION', 'HEADER', 'FOOTER', 'ASIDE', 'UL', 'OL', 'TABLE', 'DIALOG'].includes(tag)
        ? (push(depth, tag.toLowerCase()), depth + 1)
        : depth;
      for (const c of el.children) walk(c, nextDepth);
    };
    if (document.body) walk(document.body, 0);
    if (size > MAX) out.push('… (truncated — page is large; scroll or narrow down with browser_eval)');
    return out.join('\n');
  }

  // ---------- cursor overlay ----------
  const host = document.createElement('agentroom-overlay');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .cur{position:fixed;left:-40px;top:-40px;opacity:0;transition:left .35s cubic-bezier(.2,.8,.2,1),top .35s cubic-bezier(.2,.8,.2,1),opacity .4s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
      .tag{position:absolute;left:16px;top:16px;padding:2px 7px;border-radius:999px;font:600 11px/1.5 system-ui,sans-serif;color:#fff;white-space:nowrap}
      .box{position:fixed;border:2px solid;border-radius:6px;opacity:0;transition:opacity .25s}
      .box span{position:absolute;left:-2px;top:-20px;padding:1px 6px;border-radius:4px;font:500 10px/1.6 ui-monospace,monospace;color:#fff;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
      .ripple{position:fixed;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;animation:r .6s ease-out forwards}
      @keyframes r{from{transform:scale(1);opacity:.7}to{transform:scale(5);opacity:0}}
      .pick{position:fixed;border:2px dashed #3b82f6;background:rgba(59,130,246,.12);border-radius:4px;display:none}
      .pick span{position:absolute;left:-2px;top:-20px;padding:1px 6px;border-radius:4px;background:#3b82f6;color:#fff;font:500 10px/1.6 ui-monospace,monospace;white-space:nowrap}
    </style>
    <div class="box"><span></span></div>
    <div class="pick"><span></span></div>
    <div class="cur"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 2l13 7-6 1.5L7.5 17z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><div class="tag"></div></div>`;
  const cur = root.querySelector('.cur') as HTMLElement;
  const curPath = root.querySelector('path') as SVGPathElement;
  const curTag = root.querySelector('.tag') as HTMLElement;
  const box = root.querySelector('.box') as HTMLElement;
  const boxLabel = box.querySelector('span') as HTMLElement;
  const pickBox = root.querySelector('.pick') as HTMLElement;
  const pickLabel = pickBox.querySelector('span') as HTMLElement;
  const mount = () => {
    if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
  };
  let boxTimer: ReturnType<typeof setTimeout> | undefined;
  let curTimer: ReturnType<typeof setTimeout> | undefined;

  const describe = (el: Element) => {
    const role = roleOf(el) ?? el.tagName.toLowerCase();
    const name = clip(nameOf(el), 50);
    return name ? `${role} "${name}"` : role;
  };

  async function showActor(el: Element, actor: { name: string; color: string }, verb: string) {
    mount();
    const r = el.getBoundingClientRect();
    curPath.setAttribute('fill', actor.color);
    curTag.style.background = actor.color;
    curTag.textContent = `${actor.name} · ${verb}`;
    cur.style.opacity = '1';
    clearTimeout(curTimer);
    curTimer = setTimeout(() => (cur.style.opacity = '0'), 3000);
    cur.style.left = `${r.left + Math.min(r.width / 2, 40)}px`;
    cur.style.top = `${r.top + r.height / 2}px`;
    box.style.cssText = `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 2}px;height:${r.height + 2}px;border-color:${actor.color};opacity:1`;
    boxLabel.style.background = actor.color;
    boxLabel.textContent = describe(el);
    clearTimeout(boxTimer);
    boxTimer = setTimeout(() => (box.style.opacity = '0'), 1400);
    await new Promise((res) => setTimeout(res, 380));
  }

  function ripple(el: Element, color: string) {
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'ripple';
    d.style.cssText = `left:${r.left + Math.min(r.width / 2, 40)}px;top:${r.top + r.height / 2}px;background:${color}`;
    root.appendChild(d);
    setTimeout(() => d.remove(), 700);
  }

  // ---------- commands ----------
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pressKey = (target: Element, key: string) => {
    const opts = { key, code: key, bubbles: true, cancelable: true };
    const down = target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (down && key === 'Enter') {
      const form = (target as HTMLInputElement).form;
      if (form && target.tagName !== 'TEXTAREA') form.requestSubmit();
    }
  };

  type Actor = { name: string; color: string };
  async function run(cmd: any, actor: Actor): Promise<string> {
    switch (cmd.op) {
      case 'snapshot':
        return snapshot();
      case 'click': {
        const el = byRef(cmd.ref);
        el.scrollIntoView({ block: 'center', inline: 'center' });
        await showActor(el, actor, 'click');
        ripple(el, actor.color);
        const r = el.getBoundingClientRect();
        const pt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
        el.dispatchEvent(new PointerEvent('pointerdown', pt));
        el.dispatchEvent(new MouseEvent('mousedown', pt));
        el.focus?.({ preventScroll: true });
        el.dispatchEvent(new PointerEvent('pointerup', pt));
        el.dispatchEvent(new MouseEvent('mouseup', pt));
        el.click();
        return `Clicked ${describe(el)}`;
      }
      case 'type': {
        const el = byRef(cmd.ref);
        el.scrollIntoView({ block: 'center' });
        await showActor(el, actor, 'typing');
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setValue(el, cmd.text);
        else if (el instanceof HTMLSelectElement) {
          const opt = [...el.options].find((o) => o.value === cmd.text || o.text.trim() === cmd.text);
          if (!opt) throw new Error(`No option "${cmd.text}". Options: ${[...el.options].map((o) => o.text.trim()).join(', ')}`);
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.isContentEditable) {
          document.execCommand('selectAll');
          document.execCommand('insertText', false, cmd.text);
        } else throw new Error(`${describe(el)} is not editable`);
        if (cmd.submit) pressKey(el, 'Enter');
        return `Typed into ${describe(el)}${cmd.submit ? ' and pressed Enter' : ''}`;
      }
      case 'press': {
        const el = document.activeElement ?? document.body;
        pressKey(el, cmd.key);
        return `Pressed ${cmd.key} on ${describe(el)}`;
      }
      case 'wait_for': {
        const end = Date.now() + (cmd.timeoutMs ?? 5000);
        while (Date.now() < end) {
          if ((document.body?.innerText ?? '').includes(cmd.text)) return `Found "${cmd.text}"`;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`"${cmd.text}" did not appear within ${cmd.timeoutMs}ms`);
      }
      case 'back':
        history.back();
        return 'Went back';
      case 'eval': {
        const body = /\breturn\b/.test(cmd.code) ? cmd.code : `return (${cmd.code})`;
        const value = await new Function(`return (async () => { ${body} })()`)();
        return value === undefined ? 'undefined' : clip(fmt(value), 8000);
      }
    }
    throw new Error(`Unknown command ${cmd.op}`);
  }

  // ---------- element picker ----------
  let picking = false;
  const selectorOf = (el: Element): string => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 5) {
      const tag: string = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      const same = parent ? [...parent.children].filter((c) => c.tagName === cur!.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
      if (cur.id) {
        parts[0] = `#${CSS.escape(cur.id)}`;
        break;
      }
      cur = parent;
    }
    return parts.join(' > ');
  };
  const onPickMove = (e: MouseEvent) => {
    const el = e.target as Element;
    if (!el || el === host) return;
    const r = el.getBoundingClientRect();
    pickBox.style.cssText = `display:block;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width}px;height:${r.height}px`;
    pickLabel.textContent = `${selectorOf(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  };
  const stopPick = () => {
    picking = false;
    pickBox.style.display = 'none';
    removeEventListener('mousemove', onPickMove, true);
    removeEventListener('click', onPickClick, true);
    removeEventListener('keydown', onPickKey, true);
    post({ type: 'pick_state', on: false });
  };
  const onPickClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target as Element;
    const r = el.getBoundingClientRect();
    post({
      type: 'picked',
      element: {
        url: location.href,
        selector: selectorOf(el),
        label: describe(el),
        text: clip(text(el), 500),
        html: clip(el.outerHTML, 1500),
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      },
    });
    stopPick();
  };
  const onPickKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') stopPick();
  };

  addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window.parent || !d || d.__agentroom !== true) return;
    if (d.type === 'cmd') {
      try {
        post({ type: 'result', id: d.id, ok: true, result: await run(d.cmd, d.actor) });
      } catch (err) {
        post({ type: 'result', id: d.id, ok: false, error: String((err as Error)?.message ?? err) });
      }
    } else if (d.type === 'pick') {
      if (d.on && !picking) {
        mount();
        picking = true;
        addEventListener('mousemove', onPickMove, true);
        addEventListener('click', onPickClick, true);
        addEventListener('keydown', onPickKey, true);
        post({ type: 'pick_state', on: true });
      } else if (!d.on && picking) stopPick();
    } else if (d.type === 'nav') {
      if (d.action === 'back') history.back();
      else if (d.action === 'forward') history.forward();
      else if (d.action === 'reload') location.reload();
    }
  });
}

/** The bridge, as a self-invoking script for injection into pages. */
export const BRIDGE_JS = `(${agentroomBridge.toString()})();`;
