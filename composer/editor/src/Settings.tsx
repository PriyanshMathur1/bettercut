import React, { useEffect, useState } from "react";
import { api, type CloudConfig, type ConnectorLink, type MemoryItem, type ModelConnection } from "./api";
import { signOut } from "./auth";

type Tab = "Connect" | "Model" | "Memory" | "Account";

export const Settings: React.FC<{ cfg: CloudConfig; tab: Tab; setTab: (t: Tab) => void; email: string; onClose: () => void }> = ({ cfg, tab, setTab, email, onClose }) => (
  <div className="modal" onClick={onClose}>
    <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
      <div className="row">
        <h2>Settings</h2>
        <div className="spacer" />
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modes">
        {(["Connect", "Model", "Memory", "Account"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "Model" ? "API key" : t === "Connect" ? "Connect your AI" : t}
          </button>
        ))}
      </div>
      {tab === "Connect" ? <Connect /> : tab === "Model" ? <Models cfg={cfg} /> : tab === "Memory" ? <Memory /> : <Account email={email} cfg={cfg} />}
    </div>
  </div>
);

const Connect: React.FC = () => {
  const [link, setLink] = useState<ConnectorLink | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.connector().then(setLink).catch((e) => setErr(e.message));
  }, []);
  const make = () => api.makeConnector().then(setLink).catch((e) => setErr(e.message));
  const local = !!link?.url && /^http:\/\/(localhost|127\.0\.0\.1)/.test(link.url);
  return (
    <>
      <p className="hint">
        Edit your reels by chatting in Claude, ChatGPT or any AI app that supports connectors (MCP). It runs on your normal subscription: no API key. Keep this editor open and
        every change appears here as it happens.
      </p>
      {err ? <p className="err">{err}</p> : null}
      {link === null ? <p className="hint">Loading…</p> : null}
      {link && !link.on ? (
        <div className="row end">
          <button className="primary" onClick={make}>
            Create my connector link
          </button>
        </div>
      ) : null}
      {link?.on ? (
        <>
          <h3>Your connector link</h3>
          <div className="row">
            <input id="connector-url" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch {
                  (document.getElementById("connector-url") as HTMLInputElement | null)?.select();
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <small className="hint">
            Anyone with this link can edit your reels, so treat it like a password.{" "}
            {link.lastUsed ? `Last used ${new Date(link.lastUsed * 1000).toLocaleString()}.` : "Not used yet."}
          </small>
          {local ? (
            <p className="hint">
              This copy of BetterCut runs on your computer, so the link only works for AI apps on this computer (Claude Code, Claude Desktop). Claude.ai and ChatGPT need the
              hosted site.
            </p>
          ) : null}
          <h3>How to use it</h3>
          <ol className="hint steps">
            <li>In your AI app's settings, add a custom connector and paste the link.</li>
            <li>Ask for an edit, for example: "List my reels, then tighten the pauses in the latest one and make the hook a question."</li>
            <li>Watch it change here. Undo works as usual.</li>
          </ol>
          <div className="row end">
            <button
              onClick={() => {
                if (window.confirm("Make a new link? The old one stops working, so you'll need to paste the new one into your AI app.")) make();
              }}
            >
              New link
            </button>
            <button
              onClick={() => {
                if (window.confirm("Turn the connector off? Your AI app will no longer be able to edit your reels."))
                  api.removeConnector().then(() => setLink({ on: false, url: "", lastUsed: null })).catch((e) => setErr(e.message));
              }}
            >
              Turn off
            </button>
          </div>
        </>
      ) : null}
    </>
  );
};

const Models: React.FC<{ cfg: CloudConfig }> = ({ cfg }) => {
  const [rows, setRows] = useState<ModelConnection[] | null>(null);
  const [provider, setProvider] = useState(cfg.providers[0]?.id || "anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api.models().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  const p = cfg.providers.find((x) => x.id === provider);
  const label = (id: string) => cfg.providers.find((x) => x.id === id)?.label || id;
  return (
    <>
      <p className="hint">
        Optional. To use the Notes box inside this editor, connect a model with an API key: notes you leave on a reel are then applied by your own AI model, on your own account. Your key is stored encrypted, is only used to apply your notes, and is never shown again after you save it.
      </p>
      {rows === null ? <p className="hint">Loading…</p> : null}
      {rows?.length ? (
        <ul className="list">
          {rows.map((c) => (
            <li key={c.id}>
              <span>
                <b>{c.model}</b> <small>{label(c.provider)}{c.keyLast4 ? ` · key ending ${c.keyLast4}` : ""}{c.caps.vision ? " · can see frames" : ""}</small>
              </span>
              {c.isDefault ? (
                <span className="tag-inline">in use</span>
              ) : (
                <button className="link" onClick={() => api.defaultModel(c.id).then(load)}>
                  Use this
                </button>
              )}
              <button
                className="x"
                title="Remove this model and delete its key"
                onClick={() => {
                  if (window.confirm(`Remove ${c.model} and delete its key?`)) api.removeModel(c.id).then(load);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : rows ? (
        <p className="hint">No model connected yet.</p>
      ) : null}

      <h3>Connect a model</h3>
      <label className="field">
        <span>Provider</span>
        <select id="model-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {cfg.providers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Model name</span>
        <input id="model-name" value={model} onChange={(e) => setModel(e.target.value)} placeholder={p?.example} autoComplete="off" />
      </label>
      {p?.needsBase ? (
        <label className="field">
          <span>Base URL</span>
          <input id="model-base" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" />
        </label>
      ) : null}
      <label className="field">
        <span>API key{p?.needsBase ? " (if the server needs one)" : ""}</span>
        <input id="model-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your key" autoComplete="off" />
      </label>
      {err ? <p className="err">{err}</p> : null}
      <div className="row end">
        <button
          className="primary"
          disabled={busy || !model.trim() || (!p?.needsBase && !apiKey.trim())}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await api.addModel({ provider, model: model.trim(), apiKey: apiKey.trim(), apiBase: apiBase.trim() });
              setModel("");
              setApiKey("");
              setApiBase("");
              await load();
            } catch (e: any) {
              setErr(e.message);
            }
            setBusy(false);
          }}
        >
          {busy ? "Testing with a small edit…" : "Test and save"}
        </button>
      </div>
      <small className="hint">Saving runs one small test edit to check the model can use BetterCut's editing tools. It costs a fraction of a cent on your account.</small>
    </>
  );
};

const KIND_LABEL: Record<MemoryItem["kind"], string> = { spelling: "Spellings", preference: "Defaults for new reels", style: "How you like your edits" };
const KIND_HINT: Record<MemoryItem["kind"], string> = {
  spelling: "Names, brands and jargon. Used when transcribing, so captions spell them right. Separate with commas.",
  preference: "Settings applied to every new reel. The AI suggests these when you repeat the same change.",
  style: "Plain instructions the AI follows whenever it applies your notes.",
};

const Memory: React.FC = () => {
  const [rows, setRows] = useState<MemoryItem[] | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = () => api.memory().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  const proposed = rows?.filter((m) => m.status === "proposed") || [];
  const add = async (kind: MemoryItem["kind"]) => {
    const t = (text[kind] || "").trim();
    if (!t) return;
    setErr("");
    try {
      await api.addMemory({ kind, text: t });
      setText((x) => ({ ...x, [kind]: "" }));
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <>
      <p className="hint">What BetterCut remembers about how you like your reels. Nothing is saved here without you: suggestions from the AI wait for your OK.</p>
      {err ? <p className="err">{err}</p> : null}
      {proposed.length ? (
        <>
          <h3>Suggested by your AI</h3>
          <ul className="list">
            {proposed.map((m) => (
              <li key={m.id}>
                <span>
                  {m.text} {m.value ? <small>({JSON.stringify(m.value)})</small> : null}
                </span>
                <button className="link" onClick={() => api.editMemory(m.id, { status: "active" }).then(load)}>
                  Keep
                </button>
                <button className="link" onClick={() => api.removeMemory(m.id).then(load)}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {(["spelling", "style", "preference"] as const).map((kind) => {
        const items = rows?.filter((m) => m.kind === kind && m.status === "active") || [];
        return (
          <div key={kind}>
            <h3>{KIND_LABEL[kind]}</h3>
            <small className="hint">{KIND_HINT[kind]}</small>
            <ul className="list">
              {items.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.text} {m.value ? <small>({JSON.stringify(m.value)})</small> : null}
                  </span>
                  <button className="x" title="Forget this" onClick={() => api.removeMemory(m.id).then(load)}>
                    ×
                  </button>
                </li>
              ))}
              {rows && !items.length ? <li className="none">Nothing yet.</li> : null}
            </ul>
            {kind !== "preference" ? (
              <div className="row">
                <input
                  id={`mem-${kind}`}
                  value={text[kind] || ""}
                  placeholder={kind === "spelling" ? "Diners Club, SmartBuy, HDFC" : "Hooks should be questions. No emoji."}
                  onChange={(e) => setText((x) => ({ ...x, [kind]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && add(kind)}
                />
                <button onClick={() => add(kind)} disabled={!(text[kind] || "").trim()}>
                  Add
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
};

const Account: React.FC<{ email: string; cfg: CloudConfig }> = ({ email, cfg }) => {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);
  return (
    <>
      <ul className="list">
        <li>
          <span>Signed in as</span>
          <b>{email || me?.email || "this computer"}</b>
        </li>
        {me ? (
          <>
            <li>
              <span>Reels</span>
              <b>
                {me.projects} of {me.limits.projects}
              </b>
            </li>
            <li>
              <span>Renders in the last 24 hours</span>
              <b>
                {me.rendersToday} of {me.limits.rendersPerDay}
              </b>
            </li>
            <li>
              <span>Storage used</span>
              <b>{(me.storageBytes / 1e6).toFixed(0)} MB</b>
            </li>
          </>
        ) : null}
      </ul>
      {cfg.auth === "supabase" ? (
        <div className="row end">
          <button onClick={signOut}>Sign out</button>
        </div>
      ) : null}
    </>
  );
};
