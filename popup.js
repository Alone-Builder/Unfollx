const ZIP = "https://github.com/Alone-Builder/Unfollx/archive/refs/heads/main.zip";
const $ = (id) => document.getElementById(id);

async function refresh(force) {
  $("msg").textContent = "Checking for updates…";
  let r;
  try { r = await chrome.runtime.sendMessage({ type: "check", force }); } catch { r = null; }
  if (!r || r.error) {
    $("msg").textContent = (r && r.error) || "Could not check for updates.";
    $("box").hidden = true;
    return;
  }
  $("box").hidden = !r.available;
  if (r.available) {
    $("msg").textContent = "";
    $("title").textContent = `Update available: ${r.latest} (you have ${r.current})`;
  } else {
    $("msg").textContent = `You're up to date (version ${r.current}).`;
  }
}

$("dl").onclick = () => chrome.tabs.create({ url: ZIP });
$("reload").onclick = () => chrome.runtime.sendMessage({ type: "reload" });
$("recheck").onclick = () => refresh(true);
refresh(false);
