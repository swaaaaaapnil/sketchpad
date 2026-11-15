import { useState } from 'react';
import { PROVIDERS, generateShapes } from '../lib/ai.js';

const PREFS_KEY = 'sketchpad.ai.prefs';
const keyName = (provider) => `sketchpad.ai.key.${provider}`;

function loadKey(provider) {
  try {
    return localStorage.getItem(keyName(provider)) || '';
  } catch {
    return '';
  }
}

function storeKey(provider, key) {
  try {
    if (key) localStorage.setItem(keyName(provider), key);
    else localStorage.removeItem(keyName(provider));
  } catch {
    /* storage blocked: the key just lasts for this session */
  }
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export default function AIPanel({ open, onClose, onShapes }) {
  const prefs = loadPrefs();
  const initial = PROVIDERS[prefs.provider] ? prefs.provider : 'anthropic';
  const sameAsSaved = prefs.provider === initial;
  const [provider, setProvider] = useState(initial);
  const [baseUrl, setBaseUrl] = useState((sameAsSaved && prefs.baseUrl) || PROVIDERS[initial].baseUrl);
  const [model, setModel] = useState((sameAsSaved && prefs.model) || PROVIDERS[initial].model);
  const [apiKey, setApiKey] = useState(() => loadKey(initial));
  const [remember, setRemember] = useState(() => !!loadKey(initial));
  const [prompt, setPrompt] = useState('A login flow: landing page, form, validation, dashboard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function savePrefs(next) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ provider, baseUrl, model, ...next }));
    } catch {
      /* storage unavailable; preferences are optional */
    }
  }

  function changeProvider(value) {
    setProvider(value);
    setBaseUrl(PROVIDERS[value].baseUrl);
    setModel(PROVIDERS[value].model);
    const saved = loadKey(value);
    setApiKey(saved);
    setRemember(!!saved);
    savePrefs({ provider: value, baseUrl: PROVIDERS[value].baseUrl, model: PROVIDERS[value].model });
  }

  async function run(e) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    if (PROVIDERS[provider].needsKey && !apiKey.trim()) {
      setError(`Add your ${PROVIDERS[provider].label} API key first.`);
      return;
    }
    storeKey(provider, remember ? apiKey.trim() : '');
    setBusy(true);
    setError('');
    try {
      const shapes = await generateShapes({ provider, baseUrl, apiKey: apiKey.trim(), model, prompt });
      onShapes(shapes);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const info = PROVIDERS[provider];

  return (
    <aside className={`ai-panel ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label="AI diagram">
      <header className="ai-head">
        <div>
          <h2>Draw with AI</h2>
          <p>Describe a diagram. It is drawn onto your canvas and stays editable.</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close AI panel">✕</button>
      </header>

      <form onSubmit={run} className="ai-form">
        <label className="field">
          <span>Provider</span>
          <select value={provider} onChange={(e) => changeProvider(e.target.value)}>
            {Object.entries(PROVIDERS).map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
        </label>

        {provider !== 'anthropic' && provider !== 'supabase' && (
          <label className="field">
            <span>Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
          </label>
        )}

        {provider !== 'supabase' && <label className="field">
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        </label>}

        {info.needsKey && (
          <div className="field">
            <span className="field-row">
              <label htmlFor="ai-key">Your API key</label>
              <a href={info.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a>
            </span>
            <input
              id="ai-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={info.keyHint}
              autoComplete="off"
              spellCheck={false}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  setRemember(e.target.checked);
                  if (!e.target.checked) storeKey(provider, '');
                }}
              />
              Remember on this device
            </label>
          </div>
        )}

        <label className="field">
          <span>Prompt</span>
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>

        <button className="primary-btn" type="submit" disabled={busy || !prompt.trim() || (info.needsKey && !apiKey.trim())}>
          {busy ? 'Drawing…' : 'Generate diagram'}
        </button>

        {error && <p className="error" role="alert">{error}</p>}
        <p className="fine">
          {provider === 'supabase' ? 'The model key lives on your Supabase edge function, never in the browser.' : `Your key goes straight from this browser to ${info.label.split(' ')[0]} and never touches our servers.${info.needsKey ? (remember ? ' It is saved in this browser only.' : ' It is forgotten when you close the tab.') : ''} Usage is billed to your own account.`}
          {provider === 'ollama' && ' Start Ollama or LM Studio with CORS enabled for localhost.'}
        </p>
      </form>
    </aside>
  );
}
