/**
 * ISP Billing — mobile shell setup logic.
 *
 * This page is the only asset bundled inside the APK. Its job is to learn the
 * ISP operator's tunnel domain, persist it, and hand the WebView over to the
 * remote client portal. Every screen after the redirect is served by the panel.
 *
 * Capacitor injects its bridge before our scripts run in the native shell, so
 * the plugins are read from the global object rather than imported/bundled.
 */

const { Preferences, App: CapApp, SplashScreen, StatusBar, CapacitorHttp } = window.Capacitor?.Plugins || {};

const DOMAIN_KEY = 'tunnel_domain';
const VALIDATE_PATH = '/api/public/store-settings';
const PORTAL_PATH = '/client_portal';
const REQUEST_TIMEOUT = 10000;
const MAX_REDIRECT_ATTEMPTS = 4;

const el = (id) => document.getElementById(id);

const dom = {
  connectingView: el('connecting-view'),
  connectingDomain: el('connecting-domain'),
  connectingHint: el('connecting-hint'),
  connectingChangeBtn: el('connecting-change-btn'),
  setupView: el('setup-view'),
  input: el('domain-input'),
  statusBox: el('status-box'),
  statusIcon: el('status-icon'),
  statusText: el('status-text'),
  testBtn: el('test-btn'),
  testBtnSpinner: el('test-btn-spinner'),
  connectBtn: el('connect-btn'),
  connectBtnSpinner: el('connect-btn-spinner'),
  savedHint: el('saved-hint'),
  savedDomain: el('saved-domain'),
  settingsLink: el('settings-link')
};

const ICONS = {
  ok: '✓',
  error: '✕',
  testing: '…'
};

/* ------------------------------------------------------------------ storage */
/** Preferences in the native shell, localStorage when previewed in a browser. */
async function readDomain() {
  try {
    if (Preferences) {
      const { value } = await Preferences.get({ key: DOMAIN_KEY });
      return value || null;
    }
    return window.localStorage.getItem(DOMAIN_KEY);
  } catch (error) {
    console.warn('[setup] unable to read saved domain', error);
    return null;
  }
}

async function saveDomain(domain) {
  if (Preferences) {
    await Preferences.set({ key: DOMAIN_KEY, value: domain });
    return;
  }
  window.localStorage.setItem(DOMAIN_KEY, domain);
}

async function clearDomain() {
  try {
    if (Preferences) {
      await Preferences.remove({ key: DOMAIN_KEY });
      return;
    }
    window.localStorage.removeItem(DOMAIN_KEY);
  } catch (error) {
    console.warn('[setup] unable to clear saved domain', error);
  }
}

/* ------------------------------------------------------------- normalization */
/**
 * Turns whatever the customer typed into an absolute origin.
 * "billing.isp.com/" -> "https://billing.isp.com"
 */
function normalizeDomain(raw) {
  let value = (raw || '').trim();
  if (!value) return null;

  value = value.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  value = value.replace(/\/+$/, '');

  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return null;
  }

  // A bare hostname without a dot (e.g. "billing") cannot resolve publicly.
  if (!url.hostname || !url.hostname.includes('.')) return null;

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/* ------------------------------------------------------------------- helpers */
function isOnline() {
  return navigator.onLine !== false;
}

function showStatus(kind, message) {
  dom.statusBox.classList.remove('hidden', 'status-ok', 'status-error', 'status-testing');
  dom.statusBox.classList.add(`status-${kind}`);
  dom.statusIcon.textContent = ICONS[kind] || '';
  dom.statusText.textContent = message;
}

function hideStatus() {
  dom.statusBox.classList.add('hidden');
}

function setBusy(busy, activeButton) {
  dom.testBtn.disabled = busy;
  dom.connectBtn.disabled = busy;
  dom.input.disabled = busy;
  dom.testBtnSpinner.classList.toggle('hidden', !(busy && activeButton === 'test'));
  dom.connectBtnSpinner.classList.toggle('hidden', !(busy && activeButton === 'connect'));
}

function showView(view) {
  const views = [dom.connectingView, dom.setupView];
  views.forEach((section) => {
    const active = section === view;
    section.classList.toggle('is-hidden', !active);
    if (active) {
      // Let the browser apply `display` before starting the transition.
      requestAnimationFrame(() => section.classList.add('is-visible'));
    } else {
      section.classList.remove('is-visible');
    }
  });
}

async function hideSplash() {
  try {
    await SplashScreen?.hide();
  } catch (error) {
    console.warn('[setup] splash screen hide failed', error);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------- validation */
/**
 * Probes the panel's public settings endpoint.
 * Returns { ok, reason } so callers can show a specific message.
 *
 * In the native shell the request goes through CapacitorHttp (Android's HTTP
 * stack), which bypasses WebView CORS entirely — the panel does not need CORS
 * headers for the APK to validate a domain. Browser previews fall back to a
 * no-cors fetch that only proves reachability.
 */
async function validateDomain(domain) {
  if (!isOnline()) return { ok: false, reason: 'offline' };

  if (CapacitorHttp) {
    try {
      const response = await CapacitorHttp.get({
        url: `${domain}${VALIDATE_PATH}`,
        headers: { 'X-Client': 'mobile-apk' },
        connectTimeout: REQUEST_TIMEOUT,
        readTimeout: REQUEST_TIMEOUT
      });

      if (response.status >= 200 && response.status < 400) return { ok: true };
      return { ok: false, reason: response.status === 404 ? 'not-panel' : 'server', status: response.status };
    } catch (error) {
      const message = String(error?.message || error || '').toLowerCase();
      return { ok: false, reason: message.includes('timeout') || message.includes('timed out') ? 'timeout' : 'unreachable' };
    }
  }

  // Browser preview fallback: no custom headers (they force a CORS preflight)
  // and mode 'no-cors' so a CORS-less panel still counts as reachable.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${domain}${VALIDATE_PATH}`, {
      signal: controller.signal,
      cache: 'no-store',
      mode: 'no-cors'
    });

    // Opaque responses report status 0; the server answered, so treat it as ok.
    if (response.status === 0 || response.ok) return { ok: true };
    return { ok: false, reason: response.status === 404 ? 'not-panel' : 'server', status: response.status };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(result) {
  switch (result.reason) {
    case 'offline':
      return 'No internet connection. Turn on mobile data or Wi-Fi and try again.';
    case 'timeout':
      return 'The server took too long to respond. Check the address and try again.';
    case 'not-panel':
      return 'Reached the address, but it is not an ISP Billing server.';
    case 'server':
      return `The server responded with an error (${result.status}). Contact your ISP operator.`;
    default:
      return 'Could not reach that address. Check for typos and your connection.';
  }
}

/* ------------------------------------------------------------------ redirect */
async function redirectToPanel(domain) {
  window.location.replace(`${domain}${PORTAL_PATH}`);
}

/**
 * Auto-launch path: verify the saved server is reachable before handing the
 * WebView over, retrying with exponential backoff so a slow tunnel or a
 * still-connecting radio does not dump the customer back into setup.
 */
async function connectSavedDomain(domain) {
  dom.connectingDomain.textContent = domain;
  showView(dom.connectingView);
  await hideSplash();

  let lastResult = { reason: 'unreachable' };

  for (let attempt = 1; attempt <= MAX_REDIRECT_ATTEMPTS; attempt += 1) {
    lastResult = await validateDomain(domain);
    if (lastResult.ok) {
      await redirectToPanel(domain);
      return;
    }

    if (attempt < MAX_REDIRECT_ATTEMPTS) {
      const delay = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      dom.connectingHint.textContent = `Retrying in ${delay / 1000}s… (attempt ${attempt + 1} of ${MAX_REDIRECT_ATTEMPTS})`;
      await wait(delay);
    }
  }

  // Still unreachable: fall back to the form with the address pre-filled.
  showSetupForm(domain);
  showStatus('error', describeFailure(lastResult));
}

/* --------------------------------------------------------------- setup form */
function showSetupForm(savedDomain) {
  if (savedDomain) {
    dom.input.value = savedDomain.replace(/^https?:\/\//i, '');
    dom.savedDomain.textContent = savedDomain;
    dom.savedHint.classList.remove('hidden');
    dom.settingsLink.classList.remove('hidden');
  }
  showView(dom.setupView);
}

function readInputDomain() {
  const domain = normalizeDomain(dom.input.value);
  if (!domain) {
    showStatus('error', 'Enter a valid address, for example billing.your-isp.com');
    return null;
  }
  return domain;
}

async function handleTest() {
  const domain = readInputDomain();
  if (!domain) return;

  setBusy(true, 'test');
  showStatus('testing', `Testing ${domain}…`);

  const result = await validateDomain(domain);
  setBusy(false);

  if (result.ok) {
    showStatus('ok', 'Connected. Your ISP billing server is reachable.');
  } else {
    showStatus('error', describeFailure(result));
  }
}

async function handleConnect() {
  const domain = readInputDomain();
  if (!domain) return;

  setBusy(true, 'connect');
  showStatus('testing', 'Connecting…');

  const result = await validateDomain(domain);
  if (!result.ok) {
    setBusy(false);
    showStatus('error', describeFailure(result));
    return;
  }

  try {
    await saveDomain(domain);
  } catch (error) {
    setBusy(false);
    showStatus('error', 'Could not save the address on this device. Please try again.');
    return;
  }

  showStatus('ok', 'Connected. Opening your portal…');
  await redirectToPanel(domain);
}

async function handleChangeServer() {
  await clearDomain();
  hideStatus();
  dom.savedHint.classList.add('hidden');
  dom.settingsLink.classList.add('hidden');
  dom.input.value = '';
  showView(dom.setupView);
  dom.input.focus();
}

/* ----------------------------------------------------------------- bootstrap */
function wireEvents() {
  dom.testBtn.addEventListener('click', handleTest);
  dom.connectBtn.addEventListener('click', handleConnect);
  dom.settingsLink.addEventListener('click', handleChangeServer);
  dom.connectingChangeBtn.addEventListener('click', handleChangeServer);

  dom.input.addEventListener('input', hideStatus);
  dom.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleConnect();
    }
  });

  window.addEventListener('offline', () => {
    showStatus('error', 'You are offline. Reconnect to continue.');
  });
  window.addEventListener('online', hideStatus);

  // Hardware back button: exit instead of leaving a blank WebView behind.
  CapApp?.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      CapApp.exitApp();
    }
  });
}

async function init() {
  try {
    await StatusBar?.setBackgroundColor({ color: '#0f172a' });
  } catch (error) {
    // Not fatal — some devices/emulators reject the call.
  }

  wireEvents();

  const savedDomain = await readDomain();
  if (savedDomain) {
    await connectSavedDomain(savedDomain);
    return;
  }

  showSetupForm(null);
  await hideSplash();
}

init();
