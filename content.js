// Runs on instagram.com and uses the session you are already logged in with.
// Nothing is stored: every scan reads your live followers/following lists.
(() => {
  if (window.__ignfLoaded) return;
  window.__ignfLoaded = true;

  const APP_ID = "936619743392459"; // Instagram web app id, sent by instagram.com itself
  const PAGE_DELAY = [900, 1800];   // pause between list pages while scanning (ms)
  const UNFOLLOW_DELAY = [20000, 40000]; // pause between unfollows in a batch (ms)

  // Groups produced by a scan.
  //  nonfollowers: you follow them, they don't follow you  (the only group you can unfollow here)
  //  mutual:       you follow each other                   (kept safe, read-only)
  //  fans:         they follow you, you don't follow them  (read-only)
  const TABS = [
    { key: "nonfollowers", label: "Not following back", empty: "Everyone you follow follows you back." },
    { key: "mutual", label: "Follow you back", empty: "No mutual followers found." },
    { key: "fans", label: "Fans", empty: "Nobody follows you without you following them." },
  ];

  const state = {
    groups: { nonfollowers: [], mutual: [], fans: [] },
    tab: "nonfollowers",
    selected: new Set(), done: new Set(), busy: false, stop: false, scanned: false,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const between = ([a, b]) => a + Math.random() * (b - a);
  const cookie = (name) => (document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)")) || [])[1] || "";
  const uid = (u) => String(u.pk ?? u.pk_id ?? u.id);

  async function api(path, options = {}) {
    const res = await fetch("https://www.instagram.com/api/v1/" + path, {
      credentials: "include",
      ...options,
      headers: {
        "x-ig-app-id": APP_ID,
        "x-csrftoken": cookie("csrftoken"),
        "x-requested-with": "XMLHttpRequest",
        ...(options.headers || {}),
      },
    });
    if (res.status === 429) throw new Error("Instagram is rate-limiting you. Wait a few hours before trying again.");
    if (res.status === 401 || res.status === 403) throw new Error("Instagram refused the request. Make sure you are logged in, then reload the page.");
    if (!res.ok) throw new Error(`Instagram returned an error (${res.status}).`);
    const data = await res.json();
    if (data.status === "fail") throw new Error(data.message || "Instagram blocked this action. Wait before trying again.");
    return data;
  }

  async function fetchList(kind, userId, onPage) {
    const users = new Map();
    let maxId = "";
    do {
      const q = `friendships/${userId}/${kind}/?count=50` + (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
      const data = await api(q);
      for (const u of data.users || []) users.set(uid(u), u);
      onPage(users.size);
      maxId = data.next_max_id || "";
      if (state.stop) throw new Error("Scan stopped.");
      if (maxId) await sleep(between(PAGE_DELAY));
    } while (maxId);
    return users;
  }

  // ---------- panel ----------
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) n.append(k);
    return n;
  };

  const launcher = el("button", { className: "ignf-launch", title: "Unfollx: sort who follows you back" },
    el("span", { className: "ignf-launch-dot" }), "Unfollx");
  const status = el("div", { className: "ignf-status", textContent: "Press Scan to read your live followers and following lists." });
  const search = el("input", { className: "ignf-search", type: "search", placeholder: "Search" });
  const scanBtn = el("button", { className: "ignf-btn ignf-primary", textContent: "Scan" });
  const selectAll = el("button", { className: "ignf-btn", textContent: "Select all" });
  const batchBtn = el("button", { className: "ignf-btn ignf-danger", textContent: "Unfollow selected" });
  const stopBtn = el("button", { className: "ignf-btn", textContent: "Stop", hidden: true });
  const list = el("ul", { className: "ignf-list" });
  const close = el("button", { className: "ignf-close", textContent: "×", title: "Close" });
  const bar = el("div", { className: "ignf-bar" });
  const stats = el("div", { className: "ignf-stats", hidden: true });
  const tabBtns = {};
  const tabs = el("div", { className: "ignf-tabs", hidden: true });
  for (const t of TABS) {
    const b = el("button", { className: "ignf-tab" });
    b.onclick = () => { state.tab = t.key; render(); };
    tabBtns[t.key] = b;
    tabs.append(b);
  }
  const tools = el("div", { className: "ignf-tools" }, scanBtn, selectAll, batchBtn, stopBtn);
  const panel = el("div", { className: "ignf-panel", hidden: true },
    el("div", { className: "ignf-head" },
      el("div", { className: "ignf-title" }, el("span", { className: "ignf-logo" }), el("strong", { textContent: "Unfollx" })),
      close),
    bar,
    status,
    stats,
    tabs,
    tools,
    search,
    list,
    el("div", { className: "ignf-note", textContent: "Batch unfollows wait 20–40 seconds between accounts to keep your account safe. Instagram may still limit you if you unfollow a lot in one day." }),
  );
  document.body.append(launcher, panel);

  const setStatus = (t, bad = false) => { status.textContent = t; status.classList.toggle("ignf-bad", bad); };
  const setBusy = (b) => {
    state.busy = b;
    scanBtn.disabled = b;
    stopBtn.hidden = !b;
  };

  function render() {
    const canAct = state.tab === "nonfollowers";
    const q = search.value.trim().toLowerCase();

    for (const t of TABS) {
      const n = state.groups[t.key].length;
      const b = tabBtns[t.key];
      b.replaceChildren(t.label, el("span", { className: "ignf-count", textContent: String(n) }));
      b.classList.toggle("ignf-on", state.tab === t.key);
    }
    tabs.hidden = stats.hidden = !state.scanned;
    if (state.scanned) {
      const g = state.groups;
      stats.replaceChildren(
        stat(g.nonfollowers.length + g.mutual.length, "Following"),
        stat(g.mutual.length + g.fans.length, "Followers"),
        stat(g.nonfollowers.length, "Not following back"),
      );
    }
    tools.classList.toggle("ignf-nobatch", !canAct);
    selectAll.hidden = batchBtn.hidden = !canAct;

    const users = state.groups[state.tab];
    const shown = users.filter((u) => !q || u.username.toLowerCase().includes(q) || (u.full_name || "").toLowerCase().includes(q));
    list.replaceChildren();
    if (state.scanned && !shown.length) {
      list.append(el("li", { className: "ignf-empty", textContent: q ? "No matches." : TABS.find((t) => t.key === state.tab).empty }));
    }
    for (const u of shown) {
      const id = uid(u);
      const done = state.done.has(id);
      const row = el("li", { className: done ? "ignf-done" : "" });
      if (canAct) {
        const box = el("input", { type: "checkbox", checked: state.selected.has(id), disabled: done });
        box.onchange = () => { box.checked ? state.selected.add(id) : state.selected.delete(id); updateBatch(); };
        row.append(box);
      }
      const link = el("a", { href: `https://www.instagram.com/${u.username}/`, target: "_blank", rel: "noopener", textContent: u.username });
      row.append(
        el("span", { className: "ignf-ring" }, el("img", { src: u.profile_pic_url || "", alt: "", loading: "lazy", referrerPolicy: "no-referrer" })),
        el("span", { className: "ignf-who" }, el("span", { className: "ignf-name" }, link, u.is_verified ? el("span", { className: "ignf-tick", textContent: "✔" }) : ""), el("small", { textContent: u.full_name || "" })),
      );
      if (canAct) {
        const btn = el("button", { className: "ignf-btn ignf-small", textContent: done ? "Unfollowed" : "Unfollow", disabled: done || state.busy });
        btn.onclick = () => unfollowOne(u, btn);
        row.append(btn);
      }
      list.append(row);
    }
    updateBatch();
  }

  function stat(n, label) {
    return el("div", { className: "ignf-stat" }, el("b", { textContent: String(n) }), el("span", { textContent: label }));
  }

  function updateBatch() {
    const n = [...state.selected].filter((id) => !state.done.has(id)).length;
    batchBtn.textContent = n ? `Unfollow selected (${n})` : "Unfollow selected";
    batchBtn.disabled = state.busy || !n;
    selectAll.disabled = state.busy;
  }

  async function scan() {
    const me = cookie("ds_user_id");
    if (!me) return setStatus("You are not logged in to Instagram in this browser. Log in, then press Scan again.", true);
    setBusy(true); state.stop = false;
    state.groups = { nonfollowers: [], mutual: [], fans: [] };
    state.scanned = false; state.selected.clear(); state.done.clear(); render();
    try {
      const following = await fetchList("following", me, (n) => setStatus(`Reading who you follow… ${n}`));
      const followers = await fetchList("followers", me, (n) => setStatus(`Reading your followers… ${n}`));
      const g = state.groups;
      for (const [id, u] of following) (followers.has(id) ? g.mutual : g.nonfollowers).push(u);
      for (const [id, u] of followers) if (!following.has(id)) g.fans.push(u);
      state.scanned = true;
      setStatus(`You follow ${following.size}. ${followers.size} follow you. ${g.nonfollowers.length} don't follow you back.`);
    } catch (e) {
      setStatus(e.message, true);
    }
    setBusy(false); render();
  }

  async function unfollow(u) {
    const id = uid(u);
    await api(`friendships/destroy/${id}/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `user_id=${encodeURIComponent(id)}`,
    });
    state.done.add(id); state.selected.delete(id);
  }

  async function unfollowOne(u, btn) {
    if (state.busy) return;
    btn.disabled = true; btn.textContent = "…";
    try { await unfollow(u); setStatus(`Unfollowed ${u.username}.`); }
    catch (e) { setStatus(e.message, true); }
    render();
  }

  async function batch() {
    // Only accounts in the "not following back" group can ever be queued.
    const queue = state.groups.nonfollowers.filter((u) => state.selected.has(uid(u)) && !state.done.has(uid(u)));
    if (!queue.length || !confirm(`Unfollow ${queue.length} account(s) who don't follow you back? This will take about ${Math.ceil(queue.length * 0.5)} minute(s). Keep this tab open.`)) return;
    setBusy(true); state.stop = false; render();
    let n = 0;
    try {
      for (const u of queue) {
        if (state.stop) break;
        await unfollow(u); n++; render();
        if (n < queue.length) {
          const wait = between(UNFOLLOW_DELAY);
          for (let left = Math.ceil(wait / 1000); left > 0 && !state.stop; left--) {
            setStatus(`Unfollowed ${n} of ${queue.length}. Next in ${left}s…`);
            await sleep(1000);
          }
        }
      }
      setStatus(state.stop ? `Stopped. Unfollowed ${n} of ${queue.length}.` : `Done. Unfollowed ${n} account(s).`);
    } catch (e) {
      setStatus(`Stopped after ${n}: ${e.message}`, true);
    }
    setBusy(false); render();
  }

  launcher.onclick = () => { panel.hidden = !panel.hidden; };
  close.onclick = () => { panel.hidden = true; };
  scanBtn.onclick = scan;
  stopBtn.onclick = () => { state.stop = true; setStatus("Stopping…"); };
  batchBtn.onclick = batch;
  search.oninput = render;
  selectAll.onclick = () => {
    const open = state.groups.nonfollowers.map(uid).filter((id) => !state.done.has(id));
    const all = open.length && open.every((id) => state.selected.has(id));
    all ? state.selected.clear() : open.forEach((id) => state.selected.add(id));
    selectAll.textContent = all ? "Select all" : "Select none";
    render();
  };
  render();
})();
