const $ = (id) => document.getElementById(id);
let revision, config, adjustRequest;
async function api(path, data) {
  const r = await fetch("/api/e/admin/" + path, {
    credentials: "same-origin",
    ...(data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Request failed");
  return result;
}
const labelFor = (k) =>
  k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bE\b/g, "K")
    .replace(/^./, (s) => s.toUpperCase());
const templates = {
  catalog: {
    id: "new-item",
    kind: "character",
    earningEnabled: false,
    earningMultiplier: "1",
    rarity: "common",
    bonusPercent: "0",
    priceE: "100",
  },
  boosters: {
    id: "new-booster",
    enabled: false,
    multiplier: "1.25",
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 1800000).toISOString(),
    numberOfMatches: 10,
    modes: [],
    stackable: true,
    maximumStack: 1,
    source: "admin",
    description: "Temporary K boost",
    userIds: [],
  },
  events: {
    id: "new-event",
    enabled: false,
    multiplier: "1.10",
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 86400000).toISOString(),
    modes: ["survival"],
    stackable: true,
    maximumStack: 1,
    source: "event",
    description: "K event",
    dailyCap: null,
    maxEPerMatch: null,
    winE: null,
    directE: null,
    directDropChance: "0",
    bossIds: [],
  },
  bosses: {
    id: "new-boss",
    enabled: false,
    spawnChance: "0.001",
    health: 10000,
    damage: 50,
    scoreReward: 2000,
    directE: "250",
    minimumWave: 10,
    modes: ["survival"],
    announce: true,
  },
};
function field(parent, key, value, change) {
  if (key === "guestEarning") {
    change(false);
    const note = document.createElement("p");
    note.textContent = "K earning requires a registered login. Guests cannot earn K.";
    parent.appendChild(note);
    return;
  }
  if (Array.isArray(value)) {
    const box = document.createElement("fieldset");
    box.appendChild(
      Object.assign(document.createElement("legend"), {
        textContent: labelFor(key),
      }),
    );
    parent.appendChild(box);
    if (["modes", "userIds", "bossIds"].includes(key)) {
      const input = document.createElement("input");
      input.value = value.join(", ");
      input.placeholder =
        key === "modes" ? "All modes (empty)" : "Comma-separated IDs";
      input.onchange = () =>
        change(
          input.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      box.appendChild(input);
      return;
    }
    value.forEach((entry, i) => {
      const wrap = document.createElement("div");
      wrap.className = "array-entry";
      field(wrap, entry.id || String(i), entry, (v) => (value[i] = v));
      const remove = Object.assign(document.createElement("button"), {
        type: "button",
        textContent: "Remove",
        className: "danger",
      });
      remove.onclick = () => {
        value.splice(i, 1);
        render();
      };
      wrap.appendChild(remove);
      box.appendChild(wrap);
    });
    const add = Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "Add " + labelFor(key),
    });
    add.onclick = () => {
      value.push(structuredClone(templates[key] || {}));
      render();
    };
    box.appendChild(add);
    return;
  }
  if (value && typeof value === "object") {
    const box = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = labelFor(key);
    box.appendChild(heading);
    for (const [k, v] of Object.entries(value))
      field(box, k, v, (next) => (value[k] = next));
    parent.appendChild(box);
    return;
  }
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = labelFor(key);
  label.appendChild(caption);
  const input = document.createElement("input");
  input.type =
    typeof value === "boolean"
      ? "checkbox"
      : typeof value === "number"
        ? "number"
        : "text";
  if (typeof value === "boolean") input.checked = value;
  else input.value = value ?? "";
  input.onchange = () =>
    change(
      input.type === "checkbox"
        ? input.checked
        : input.type === "number"
          ? Number(input.value)
          : input.value === "" && nullable(key)
            ? null
            : input.value,
    );
  if (nullable(key)) input.placeholder = "Disabled (empty)";
  label.appendChild(input);
  parent.appendChild(label);
}
function nullable(k) {
  return [
    "DAILY_E_CAP",
    "MAX_E_PER_MATCH",
    "maxEPerMatch",
    "dailyCap",
    "numberOfMatches",
    "winE",
    "directE",
  ].includes(k);
}
function render() {
  $("config-fields").replaceChildren();
  for (const [k, v] of Object.entries(config))
    field($("config-fields"), k, v, (next) => (config[k] = next));
}
async function load() {
  try {
    const value = await api("config");
    ({ revision, config } = value);
    $("admin").hidden = false;
    render();
    $("status").textContent = `Configuration revision ${revision}`;
    await flags();
  } catch (e) {
    $("admin").hidden = true;
    $("status").textContent = e.message;
  }
}
async function flags() {
  try {
    const data = await api("review");
    $("flags").replaceChildren();
    for (const f of data.flags) {
      const box = document.createElement("article"),
        copy = document.createElement("p");
      copy.textContent = `${f.reason} · user ${f.user_id || "guest"} · ${new Date(f.created_at).toLocaleString()} · ${JSON.stringify(f.metadata)}`;
      box.appendChild(copy);
      if (!f.reviewed_at) {
        const b = Object.assign(document.createElement("button"), {
          textContent: "Mark reviewed",
        });
        b.onclick = async () => {
          try {
            await api("review", { id: f.id });
            await flags();
          } catch (e) {
            $("status").textContent = e.message;
          }
        };
        box.appendChild(b);
      } else
        box.appendChild(
          Object.assign(document.createElement("small"), {
            textContent: "Reviewed",
          }),
        );
      $("flags").appendChild(box);
    }
  } catch (e) {
    $("status").textContent = e.message;
  }
}
$("config-form").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const r = await api("config", { revision, config });
    revision = r.revision;
    $("status").textContent =
      `Saved revision ${revision}. Applies to new matches.`;
  } catch (err) {
    $("status").textContent = err.message;
  } finally {
    b.disabled = false;
  }
};
$("adjust-form").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(e.target));
    const fingerprint = JSON.stringify(data);
    if (adjustRequest?.fingerprint !== fingerprint)
      adjustRequest = { fingerprint, key: crypto.randomUUID() };
    data.key = adjustRequest.key;
    const result = await api("adjust", data);
    $("status").textContent = `Recorded transaction ${result.id}`;
    e.target.reset();
    adjustRequest = null;
  } catch (err) {
    $("status").textContent = err.message;
  } finally {
    b.disabled = false;
  }
};
$("reload").onclick = load;
$("refresh-flags").onclick = flags;
load();

$("ledger-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const userId = new FormData(e.target).get("userId");
    const data = await api("ledger?userId=" + encodeURIComponent(userId));
    const table = document.createElement("table");
    for (const t of data.transactions) {
      const row = document.createElement("tr");
      for (const value of [
        t.id,
        t.created_at,
        t.type,
        t.amount + " K",
        t.previous_balance + " → " + t.new_balance,
        t.description,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }
      table.appendChild(row);
    }
    $("admin-ledger").replaceChildren(table);
  } catch (err) {
    $("status").textContent = err.message;
  }
};
