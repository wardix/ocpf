import { render } from 'preact';
import { Widget } from './Widget';
import styles from './styles.css?inline';

// Hashing function for fingerprinting
function getBrowserFingerprint() {
  const navigator_info = window.navigator;
  const screen_info = window.screen;
  const user_agent = navigator_info.userAgent;
  const mime_types = navigator_info.mimeTypes?.length || 0;
  const plugins = navigator_info.plugins?.length || 0;
  const screen_depth = screen_info.colorDepth || 0;
  const screen_size = `${screen_info.width}x${screen_info.height}`;
  const local_time = new Date().getTimezoneOffset();
  const language = navigator_info.language || '';
  
  const rawString = `${user_agent}|${mime_types}|${plugins}|${screen_depth}|${screen_size}|${local_time}|${language}`;
  
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < rawString.length; i++) {
    ch = rawString.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'));
}

function getSessionToken() {
  const token = localStorage.getItem('omni_widget_session_token');
  if (token) return token;
  const match = document.cookie.match(/(?:^|; )omni_widget_session_token=([^;]*)/);
  if (match) {
    const cookieToken = decodeURIComponent(match[1]);
    localStorage.setItem('omni_widget_session_token', cookieToken);
    return cookieToken;
  }
  return null;
}

function saveSessionToken(token: string) {
  localStorage.setItem('omni_widget_session_token', token);
  document.cookie = `omni_widget_session_token=${encodeURIComponent(token)}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
}

// Main initializer
function initWidget() {
  // Read config from script tag attributes or global object
  let inboxId = 1;
  let apiUrl = 'http://localhost:3000';

  // Try global settings first
  const globalSettings = (window as any).OmniWidgetSettings;
  if (globalSettings) {
    inboxId = globalSettings.inboxId || inboxId;
    apiUrl = globalSettings.apiUrl || apiUrl;
  } else {
    // Fallback to script attributes
    const script = document.currentScript || Array.from(document.getElementsByTagName('script')).find(s => (s as HTMLScriptElement).src.includes('widget.js'));
    if (script) {
      const dataInboxId = script.getAttribute('data-inbox-id');
      const dataApiUrl = script.getAttribute('data-api-url');
      if (dataInboxId) inboxId = parseInt(dataInboxId, 10);
      if (dataApiUrl) apiUrl = dataApiUrl;
    }
  }

  // Ensure apiUrl doesn't end with slash
  if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);

  // Setup Shadow DOM Container
  const rootContainer = document.createElement('div');
  rootContainer.id = 'omni-widget-root-host';
  document.body.appendChild(rootContainer);

  const shadowRoot = rootContainer.attachShadow({ mode: 'open' });

  // Styles injection
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  shadowRoot.appendChild(styleEl);

  // Mount point
  const mountPoint = document.createElement('div');
  mountPoint.id = 'omni-widget-mount';
  shadowRoot.appendChild(mountPoint);

  const fingerprint = getBrowserFingerprint();
  const token = getSessionToken();

  render(
    <Widget 
      inboxId={inboxId} 
      apiUrl={apiUrl} 
      fingerprint={fingerprint} 
      sessionToken={token}
      onSaveSession={saveSessionToken}
    />,
    mountPoint
  );
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWidget);
} else {
  initWidget();
}
