// Runs on instagram.com and uses the session you are already logged in with.
// Nothing is stored: every scan reads your live followers/following lists.
(() => {
  if (window.__ignfLoaded) return;
  window.__ignfLoaded = true;

  const APP_ID = "936619743392459"; // Instagram web app id, sent by instagram.com itself
  const PAGE_DELAY = [900, 1800];   // pause between list pages while scanning (ms)
  // Pause between actions in a batch (ms, random inside the range).
  //  fast: averages ~1.8 s, so about 100 accounts in 3 minutes.
  //  safe: 20-40 s, far less likely to trigger an Instagram action block.
  const SPEEDS = {
    fast: { label: "Fast", range: [900, 2700] },
    safe: { label: "Safe", range: [20000, 40000] },
  };
  const FOLLOW_LIMIT = 100;            // follows allowed per logged-in account...
  const FOLLOW_WINDOW = 24 * 3600e3;   // ...per rolling 24 hours, counted separately for each account
  const LOAD_CAP = 300;                // max users loaded from another account's list

  // Groups produced by a scan.
  //  nonfollowers: you follow them, they don't follow you  (the only group you can unfollow here)
  //  mutual:       you follow each other                   (kept safe, read-only)
  //  fans:         they follow you, you don't follow them  (read-only)
  const TABS = [
    { key: "nonfollowers", label: "Not following back", empty: "Everyone you follow follows you back." },
    { key: "following", label: "Following", empty: "You don't follow anyone." },
    { key: "mutual", label: "Follow you back", empty: "No mutual followers found." },
    { key: "fans", label: "Fans", empty: "Nobody follows you without you following them." },
  ];

  const state = {
    groups: { nonfollowers: [], following: [], mutual: [], fans: [] },
    tab: "nonfollowers",
    selected: new Set(), done: new Set(), busy: false, stop: false, scanned: false,
    mode: "unfollow", speed: "fast",
    follow: { users: [], selected: new Set(), done: new Set(), loaded: false },
  };

  // Small wrapper around chrome.storage.local (speed choice + per-account follow counters).
  const store = {
    get: (k) => new Promise((r) => { try { chrome.storage.local.get(k, (v) => r(v || {})); } catch { r({}); } }),
    set: (o) => { try { chrome.storage.local.set(o); } catch {} },
  };
  const delay = () => between(SPEEDS[state.speed].range);
  const avgMinutes = (n) => Math.max(1, Math.ceil((n * (SPEEDS[state.speed].range[0] + SPEEDS[state.speed].range[1]) / 2) / 60000));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const between = ([a, b]) => a + Math.random() * (b - a);
  const cookie = (name) => (document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)")) || [])[1] || "";
  const uid = (u) => String(u.pk ?? u.pk_id ?? u.id);

  // Instagram's web client sends its current "rollout hash" in x-instagram-ajax; read it from the page.
  let rolloutHash = "";
  function rollout() {
    if (rolloutHash) return rolloutHash;
    for (const s of document.scripts) {
      const m = /"rollout_hash":"([0-9a-zA-Z]+)"/.exec(s.textContent || "");
      if (m) return (rolloutHash = m[1]);
    }
    return "1";
  }

  async function api(path, options = {}) {
    let claim = "0";
    try { claim = sessionStorage.getItem("www-claim-v2") || "0"; } catch {}
    const res = await fetch(path.startsWith("/") ? "https://www.instagram.com" + path : "https://www.instagram.com/api/v1/" + path, {
      credentials: "include",
      ...options,
      headers: {
        "accept": "*/*",
        "x-ig-app-id": APP_ID,
        "x-asbd-id": "129477",
        "x-ig-www-claim": claim,
        "x-instagram-ajax": rollout(),
        "x-csrftoken": cookie("csrftoken"),
        "x-requested-with": "XMLHttpRequest",
        ...(options.headers || {}),
      },
    });
    if (res.status === 429) throw new Error("Instagram is rate-limiting you. Wait a few hours before trying again.");
    if (res.status === 401 || res.status === 403) throw new Error("Instagram refused the request. Make sure you are logged in, then reload the page.");
    const text = await res.text();
    const seen = `${res.status} ${(res.headers.get("content-type") || "").split(";")[0] || "no type"}${res.redirected ? ", redirected" : ""}`;
    console.debug("[Unfollx]", path, seen, text.slice(0, 160));
    let data;
    try { data = JSON.parse(text); }
    catch {
      throw Object.assign(new Error(res.ok
        ? "Instagram sent a web page instead of data (login or security check). Open instagram.com, finish any prompt, reload the page and try again."
        : `Instagram returned an error (${res.status}).`), { retry: true, seen });
    }
    if (res.status === 404) throw Object.assign(new Error("Instagram returned an error (404)."), { retry: true, seen });
    if (!res.ok) throw new Error(data.message || `Instagram returned an error (${res.status}).`);
    if (data.status === "fail") throw new Error(data.message || "Instagram blocked this action. Wait before trying again.");
    return data;
  }

  // Instagram's website now follows/unfollows through GraphQL mutations (read from instagram.com's own scripts).
  const GQL = {
    unfollow: { name: "usePolarisFollowUserUnfollowMutation", doc: "25174972798866458", key: "xdt_destroy_friendship" },
    follow: { name: "usePolarisFollowUserFollowMutation", doc: "30480713304862233", key: "xdt_create_friendship" },
  };
  // Older REST paths, tried only if the GraphQL call is not recognised.
  const REST = {
    unfollow: ["/web/friendships/{id}/unfollow/", "friendships/destroy/{id}/"],
    follow: ["/web/friendships/{id}/follow/", "friendships/create/{id}/"],
  };

  let lsdToken = "";
  function lsd() {
    if (lsdToken) return lsdToken;
    for (const s of document.scripts) {
      const t = s.textContent || "";
      const m = /"LSD",\[\],\{"token":"([^"]+)"/.exec(t) || /"lsd":"([^"]+)"/.exec(t);
      if (m) return (lsdToken = m[1]);
    }
    return "";
  }

  async function gql(kind, id) {
    const g = GQL[kind], token = lsd();
    const body = new URLSearchParams({
      av: cookie("ds_user_id"), __d: "www", __user: "0", __a: "1", __req: "1", __comet_req: "7",
      lsd: token, jazoest: "2" + [...token].reduce((n, c) => n + c.charCodeAt(0), 0),
      fb_api_req_friendly_name: g.name,
      variables: JSON.stringify({ target_user_id: id }),
      server_timestamps: "true", doc_id: g.doc,
    });
    const data = await api("/graphql/query", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-fb-friendly-name": g.name, "x-fb-lsd": token },
      body,
    });
    if (!data.data || !data.data[g.key]) {
      const msg = (data.errors && data.errors[0] && data.errors[0].message) || data.message || "Instagram did not accept the request.";
      throw Object.assign(new Error(msg), { retry: true, seen: "graphql: " + msg.slice(0, 80) });
    }
    return data;
  }

  // kind = "follow" | "unfollow". GraphQL first, then the older REST paths.
  async function action(kind, id) {
    const tried = [];
    let last;
    try { return await gql(kind, id); }
    catch (e) { last = e; tried.push(`graphql → ${e.seen || e.message}`); if (!e.retry) throw e; }
    for (const p of REST[kind]) {
      try {
        return await api(p.replace("{id}", id), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `user_id=${encodeURIComponent(id)}`,
        });
      } catch (e) {
        last = e;
        tried.push(`${p.replace("{id}", "…")} → ${e.seen || e.message}`);
        if (!e.retry) throw e;
      }
    }
    throw new Error(`${last.message} Tried: ${tried.join("; ")}`);
  }

  async function fetchList(kind, userId, onPage, limit = Infinity) {
    const users = new Map();
    let maxId = "";
    do {
      const q = `friendships/${userId}/${kind}/?count=50` + (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
      const data = await api(q);
      for (const u of data.users || []) users.set(uid(u), u);
      onPage(users.size);
      maxId = data.next_max_id || "";
      if (state.stop) throw new Error("Scan stopped.");
      if (users.size >= limit) break;
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

  const launcher = el("button", { className: "ignf-launch", title: "Unfollx v" + (() => { try { return chrome.runtime.getManifest().version; } catch { return "?"; } })() },
    el("span", { className: "ignf-launch-dot" }), "Unfollx");
  // Notifications appear as a toast at the side of the screen instead of inside the panel.
  const toast = el("div", { className: "ignf-toast", hidden: true });
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
  // Speed + mode switch (shared by both views)
  const speedSel = el("select", { className: "ignf-select" });
  for (const [k, v] of Object.entries(SPEEDS)) speedSel.append(el("option", { value: k, textContent: v.label }));
  speedSel.value = state.speed;
  speedSel.onchange = () => { state.speed = speedSel.value; store.set({ speed: state.speed }); };
  speedSel.title = "Speed: Fast ≈ 3 min per 100, Safe = 20-40 s each";

  const modeBtns = {
    unfollow: el("button", { className: "ignf-tab", textContent: "Unfollow" }),
    follow: el("button", { className: "ignf-tab", textContent: "Bulk follow" }),
  };
  for (const [k, b] of Object.entries(modeBtns)) b.onclick = () => { state.mode = k; render(); };
  const modes = el("div", { className: "ignf-tabs" }, modeBtns.unfollow, modeBtns.follow);

  // ----- bulk follow view -----
  const quotaLine = el("div", { className: "ignf-quota" });
  const targetInput = el("input", { className: "ignf-search", type: "text", placeholder: "username of the account to copy from" });
  const kindSel = el("select", { className: "ignf-select" },
    el("option", { value: "followers", textContent: "Followers" }),
    el("option", { value: "following", textContent: "Following" }));
  const loadBtn = el("button", { className: "ignf-btn ignf-primary", textContent: "Load" });
  const fSelectAll = el("button", { className: "ignf-btn", textContent: "Select all" });
  const followBtn = el("button", { className: "ignf-btn ignf-primary", textContent: "Follow selected" });
  const fStopBtn = el("button", { className: "ignf-btn", textContent: "Stop", hidden: true });
  const fList = el("ul", { className: "ignf-list" });
  const followView = el("div", { className: "ignf-view", hidden: true },
    quotaLine,
    el("div", { className: "ignf-tools" }, targetInput, kindSel, loadBtn),
    el("div", { className: "ignf-tools" }, fSelectAll, followBtn, fStopBtn),
    fList);

  const unfollowView = el("div", { className: "ignf-view" }, stats, tabs, tools, search, list);

  const panel = el("div", { className: "ignf-panel", hidden: true },
    el("div", { className: "ignf-head" },
      el("div", { className: "ignf-title" }, el("span", { className: "ignf-logo" }), el("strong", { textContent: "Unfollx" })),
      el("div", { className: "ignf-head-right" }, speedSel, close)),
    bar,
    modes,
    unfollowView,
    followView,
  );
  store.get("speed").then(({ speed }) => { if (SPEEDS[speed]) { state.speed = speed; speedSel.value = speed; } });
  document.body.append(launcher, panel, toast);

  // Update banner: shown when GitHub has a newer version than the one installed.
  const updTitle = el("b");
  const updBanner = el("div", { className: "ignf-update", hidden: true },
    updTitle,
    el("small", { textContent: "Download the zip, extract it over your Unfollx folder, then reload." }),
    el("div", { className: "ignf-tools" },
      Object.assign(el("button", { className: "ignf-btn ignf-primary ignf-small", textContent: "Download update" }),
        { onclick: () => window.open("https://github.com/Alone-Builder/Unfollx/archive/refs/heads/main.zip", "_blank", "noopener") }),
      Object.assign(el("button", { className: "ignf-btn ignf-small", textContent: "Reload extension" }),
        { onclick: () => { try { chrome.runtime.sendMessage({ type: "reload" }); } catch {} setTimeout(() => location.reload(), 800); } })));
  panel.insertBefore(updBanner, modes);
  try {
    chrome.runtime.sendMessage({ type: "check" }, (r) => {
      if (chrome.runtime.lastError || !r || !r.available) return;
      updTitle.textContent = `Update available: ${r.latest} (you have ${r.current})`;
      updBanner.hidden = false;
      launcher.classList.add("ignf-has-update");
    });
  } catch {}

  let toastTimer;
  const setStatus = (t, bad = false) => {
    toast.textContent = t;
    toast.classList.toggle("ignf-bad", bad);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, bad ? 15000 : 7000);
  };
  toast.onclick = () => { toast.hidden = true; };
  const setBusy = (b) => {
    state.busy = b;
    scanBtn.disabled = loadBtn.disabled = b;
    stopBtn.hidden = fStopBtn.hidden = !b;
    speedSel.disabled = b;
  };

  function render() {
    for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle("ignf-on", state.mode === k);
    unfollowView.hidden = state.mode !== "unfollow";
    followView.hidden = state.mode !== "follow";
    if (state.mode === "follow") return renderFollow();

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
    if (!state.scanned && !state.busy) {
      list.append(el("li", { className: "ignf-empty", textContent: "Press Scan to read your followers and following." }));
    } else if (state.scanned && !shown.length) {
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
    state.groups = { nonfollowers: [], following: [], mutual: [], fans: [] };
    state.scanned = false; state.selected.clear(); state.done.clear(); render();
    try {
      const following = await fetchList("following", me, (n) => setStatus(`Reading who you follow… ${n}`));
      const followers = await fetchList("followers", me, (n) => setStatus(`Reading your followers… ${n}`));
      const g = state.groups;
      g.following = [...following.values()];
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
    await action("unfollow", id);
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
    if (!queue.length || !confirm(`Unfollow ${queue.length} account(s) who don't follow you back? This will take about ${avgMinutes(queue.length)} minute(s). Keep this tab open.`)) return;
    setBusy(true); state.stop = false; render();
    let n = 0;
    try {
      for (const u of queue) {
        if (state.stop) break;
        await unfollow(u); n++; render();
        if (n < queue.length) {
          await pause(delay(), `Unfollowed ${n} of ${queue.length}.`);
        }
      }
      setStatus(state.stop ? `Stopped. Unfollowed ${n} of ${queue.length}.` : `Done. Unfollowed ${n} account(s).`);
    } catch (e) {
      setStatus(`Stopped after ${n}: ${e.message}`, true);
    }
    setBusy(false); render();
  }

  // Wait `ms`, counting down in the status line only when the wait is long enough to matter.
  async function pause(ms, prefix) {
    if (ms < 5000) { setStatus(`${prefix} Working…`); await sleep(ms); return; }
    for (let left = Math.ceil(ms / 1000); left > 0 && !state.stop; left--) {
      setStatus(`${prefix} Next in ${left}s…`);
      await sleep(1000);
    }
  }

  // ---------- bulk follow ----------
  const RESERVED = new Set(["explore", "reels", "reel", "direct", "accounts", "p", "stories", "tv", "about", "legal", "developer"]);
  const pageUser = () => {
    const seg = location.pathname.split("/").filter(Boolean)[0] || "";
    return RESERVED.has(seg) ? "" : seg;
  };

  // Follows made from the logged-in account in the last 24 h. Counted separately per account id.
  async function quota() {
    const me = cookie("ds_user_id");
    const { follows = {} } = await store.get("follows");
    let rec = follows[me];
    if (!rec || Date.now() - rec.since > FOLLOW_WINDOW) rec = { count: 0, since: Date.now() };
    return { me, follows, rec, left: Math.max(0, FOLLOW_LIMIT - rec.count) };
  }
  async function countFollow() {
    const q = await quota();
    q.follows[q.me] = { count: q.rec.count + 1, since: q.rec.since };
    store.set({ follows: q.follows });
  }

  async function renderQuota() {
    const q = await quota();
    if (!q.me) { quotaLine.textContent = "Not logged in to Instagram."; return q; }
    const hrs = Math.max(1, Math.ceil((q.rec.since + FOLLOW_WINDOW - Date.now()) / 3600e3));
    quotaLine.textContent = q.left
      ? `This account: ${q.rec.count}/${FOLLOW_LIMIT} follows used. ${q.left} left.`
      : `This account reached ${FOLLOW_LIMIT} follows. Limit resets in about ${hrs}h. Log in with another account to continue.`;
    quotaLine.classList.toggle("ignf-bad", !q.left);
    return q;
  }

  const alreadyFollowing = () => new Set([...state.groups.nonfollowers, ...state.groups.mutual].map(uid));

  function renderFollow() {
    if (!targetInput.value) targetInput.value = pageUser();
    renderQuota();
    const f = state.follow;
    const mine = cookie("ds_user_id");
    const following = alreadyFollowing();
    fList.replaceChildren();
    if (!f.loaded) fList.append(el("li", { className: "ignf-empty", textContent: "Open another account's profile, then press Load to list their followers or following." }));
    else if (!f.users.length) fList.append(el("li", { className: "ignf-empty", textContent: "No users found (the list may be private)." }));
    for (const u of f.users) {
      const id = uid(u);
      const skip = id === mine || following.has(id);
      const done = f.done.has(id);
      const row = el("li", { className: done || skip ? "ignf-done" : "" });
      const box = el("input", { type: "checkbox", checked: f.selected.has(id), disabled: done || skip || state.busy });
      box.onchange = () => { box.checked ? f.selected.add(id) : f.selected.delete(id); updateFollowBtn(); };
      row.append(box,
        el("span", { className: "ignf-ring" }, el("img", { src: u.profile_pic_url || "", alt: "", loading: "lazy", referrerPolicy: "no-referrer" })),
        el("span", { className: "ignf-who" },
          el("span", { className: "ignf-name" }, el("a", { href: `https://www.instagram.com/${u.username}/`, target: "_blank", rel: "noopener", textContent: u.username })),
          el("small", { textContent: done ? "Followed" : skip ? (id === mine ? "You" : "Already following") : (u.full_name || "") })));
      fList.append(row);
    }
    updateFollowBtn();
  }

  function updateFollowBtn() {
    const n = state.follow.selected.size;
    followBtn.textContent = n ? `Follow selected (${n})` : "Follow selected";
    followBtn.disabled = state.busy || !n;
    fSelectAll.disabled = state.busy;
  }

  async function loadTarget() {
    const name = targetInput.value.trim().replace(/^@/, "").toLowerCase();
    if (!name) return setStatus("Type the username of the account to copy from.", true);
    setBusy(true); state.stop = false;
    const f = state.follow;
    f.users = []; f.selected.clear(); f.done.clear(); f.loaded = false; renderFollow();
    try {
      setStatus(`Looking up ${name}…`);
      const info = await api(`users/web_profile_info/?username=${encodeURIComponent(name)}`);
      const target = info.data && info.data.user;
      if (!target) throw new Error(`Could not find ${name}.`);
      const kind = kindSel.value;
      const users = await fetchList(kind, target.id, (n) => setStatus(`Reading ${name}'s ${kind}… ${n}`), LOAD_CAP);
      f.users = [...users.values()].slice(0, LOAD_CAP);
      f.loaded = true;
      setStatus(`Loaded ${f.users.length} of ${name}'s ${kind}. Tick the ones to follow.`);
    } catch (e) {
      setStatus(e.message, true);
    }
    setBusy(false); renderFollow();
  }

  async function followOne(u) {
    const id = uid(u);
    await action("follow", id);
    state.follow.done.add(id); state.follow.selected.delete(id);
    await countFollow();
  }

  async function followBatch() {
    const f = state.follow;
    const q = await renderQuota();
    if (!q.left) return setStatus(`This account already used its ${FOLLOW_LIMIT} follows. Wait for the limit to reset or switch accounts.`, true);
    const mine = cookie("ds_user_id"), following = alreadyFollowing();
    const eligible = f.users.filter((u) => f.selected.has(uid(u)) && !f.done.has(uid(u)) && uid(u) !== mine && !following.has(uid(u)));
    const queue = eligible.slice(0, q.left);
    if (!queue.length) return;
    const cut = eligible.length > queue.length ? ` (only ${q.left} allowed by this account's limit)` : "";
    if (!confirm(`Follow ${queue.length} account(s)${cut}? This will take about ${avgMinutes(queue.length)} minute(s). Keep this tab open.`)) return;
    setBusy(true); state.stop = false; renderFollow();
    let n = 0;
    try {
      for (const u of queue) {
        if (state.stop) break;
        await followOne(u); n++; renderFollow();
        if (n < queue.length) await pause(delay(), `Followed ${n} of ${queue.length}.`);
      }
      setStatus(state.stop ? `Stopped. Followed ${n} of ${queue.length}.` : `Done. Followed ${n} account(s).`);
    } catch (e) {
      setStatus(`Stopped after ${n}: ${e.message}`, true);
    }
    setBusy(false); renderFollow();
  }

  loadBtn.onclick = loadTarget;
  followBtn.onclick = followBatch;
  fStopBtn.onclick = () => { state.stop = true; setStatus("Stopping…"); };
  fSelectAll.onclick = () => {
    const f = state.follow, mine = cookie("ds_user_id"), following = alreadyFollowing();
    const open = f.users.map(uid).filter((id) => !f.done.has(id) && id !== mine && !following.has(id));
    const all = open.length && open.every((id) => f.selected.has(id));
    all ? f.selected.clear() : open.forEach((id) => f.selected.add(id));
    fSelectAll.textContent = all ? "Select all" : "Select none";
    renderFollow();
  };

  launcher.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden && state.mode === "follow") renderFollow(); };
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
