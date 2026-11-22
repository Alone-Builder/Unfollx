// Checks GitHub for a newer version of the extension and tells the popup / panel.
// Only the latest version number is cached; nothing about your Instagram account is stored.
const REPO = "Alone-Builder/Unfollx";
const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO}/main/manifest.json`;
const MIN_GAP = 30 * 60 * 1000; // don't hit GitHub more than every 30 minutes

const newer = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
};

async function check(force = false) {
  const current = chrome.runtime.getManifest().version;
  const { update } = await chrome.storage.local.get("update");
  if (!force && update && update.current === current && Date.now() - update.checkedAt < MIN_GAP) return update;
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (res.status === 404) {
      return { current, available: false, error: "Can't read the GitHub repo. It must be public for update checks to work." };
    }
    if (!res.ok) throw new Error(String(res.status));
    const latest = (await res.json()).version;
    const next = { latest, current, available: newer(latest, current), checkedAt: Date.now() };
    await chrome.storage.local.set({ update: next });
    chrome.action.setBadgeText({ text: next.available ? "NEW" : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#d62976" });
    return next;
  } catch (e) {
    return { current, available: false, error: "Could not reach GitHub to check for updates." };
  }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("update-check", { periodInMinutes: 180 }); check(true); });
chrome.runtime.onStartup.addListener(() => check(true));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "update-check") check(true); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "check") { check(!!msg.force).then(reply); return true; }
  if (msg.type === "reload") { chrome.runtime.reload(); }
});
