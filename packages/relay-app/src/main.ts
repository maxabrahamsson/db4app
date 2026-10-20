/// <reference types="vite/client" />
import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Theme Management
// ============================================================================

class ThemeManager {
  private theme: 'light' | 'dark' = 'dark';
  private hasManualPreference = false;
  private toggleBtn: HTMLButtonElement | null = null;
  private icon: HTMLElement | null = null;

  constructor() {
    this.hasManualPreference = localStorage.getItem('theme-manual') === 'true';
    this.detectTheme();
  }

  init(toggleBtnId: string) {
    this.toggleBtn = document.getElementById(toggleBtnId) as HTMLButtonElement;
    if (this.toggleBtn) {
      this.icon = this.toggleBtn.querySelector('.icon');
      this.toggleBtn.addEventListener('click', () => this.toggle());
    }

    // Listen for system changes if no manual preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!this.hasManualPreference) {
        this.setTheme(e.matches ? 'dark' : 'light', false);
      }
    });

    // Apply initial theme
    this.applyTheme();
  }

  private detectTheme() {
    if (this.hasManualPreference) {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') {
        this.theme = saved;
        return;
      }
    }
    // Default to system
    this.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private setTheme(newTheme: 'light' | 'dark', manual: boolean) {
    this.theme = newTheme;
    if (manual) {
      this.hasManualPreference = true;
      localStorage.setItem('theme-manual', 'true');
      localStorage.setItem('theme', newTheme);
    }
    this.applyTheme();
  }

  private toggle() {
    const newTheme = this.theme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme, true);
  }

  private applyTheme() {
    const root = document.documentElement;
    if (this.theme === 'light') {
      root.setAttribute('data-theme', 'light');
      if (this.icon) this.icon.textContent = '☀️';
    } else {
      root.removeAttribute('data-theme'); // Default is dark
      if (this.icon) this.icon.textContent = '🌙';
    }

    // Sync with iframe
    this.syncIframe();
  }

  public syncIframe() {
    const iframe = document.getElementById('mfe-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      // 1. Send message for instant update
      iframe.contentWindow.postMessage({ type: 'THEME_CHANGE', theme: this.theme }, '*');

      // 2. Update src URL if it hasn't loaded yet or for reload persistence
      // Note: Changing src reloads the iframe, which we might want to avoid if already loaded.
      // So we only update the src string variable used for initialization, 
      // or if we really need to force reload.
      // For now, postMessage handles the live update.
    }
  }

  public getThemeParam(): string {
    return `theme=${this.theme}`;
  }
}

const themeManager = new ThemeManager();

// ============================================================================
// Main App Logic
// ============================================================================

let isRunning = false;
let healthCheckInterval: number | null = null;

interface HealthResponse {
  status: string;
  connections: {
    browser: number;
    tcp: number;
  };
}

// DOM elements (initialized in initializeMainApp)
let statusIndicator: HTMLElement;
let statusText: HTMLElement;
let toggleBtn: HTMLButtonElement;
let httpPortInput: HTMLInputElement;
let pgPortInput: HTMLInputElement;
let httpBadge: HTMLElement;
let pgBadge: HTMLElement;

let iframe: HTMLIFrameElement;
let iframeContainer: HTMLElement;

async function checkConnectionStatus() {
  if (!isRunning) return;

  const httpPort = httpPortInput.value;
  try {
    const response = await fetch(`http://localhost:${httpPort}/health`);
    const data: HealthResponse = await response.json();

    if (data.connections.browser > 0) {
      httpPortInput.classList.add("connected");
      httpBadge.classList.add("connected");
      httpBadge.textContent = `Browser ✓`;
    } else {
      httpPortInput.classList.remove("connected");
      httpBadge.classList.remove("connected");
      httpBadge.textContent = "Browser";
    }

    if (data.connections.tcp > 0) {
      pgPortInput.classList.add("connected");
      pgBadge.classList.add("connected");
      pgBadge.textContent = `Client ✓`;
    } else {
      pgPortInput.classList.remove("connected");
      pgBadge.classList.remove("connected");
      pgBadge.textContent = "Client";
    }
  } catch {
    httpPortInput.classList.remove("connected");
    pgPortInput.classList.remove("connected");
    httpBadge.classList.remove("connected");
    pgBadge.classList.remove("connected");
    httpBadge.textContent = "Browser";
    pgBadge.textContent = "Client";
  }
}

function startHealthPolling() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  httpBadge.classList.add("visible");
  pgBadge.classList.add("visible");
  checkConnectionStatus();
  healthCheckInterval = window.setInterval(checkConnectionStatus, 1000);
}

function stopHealthPolling() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  httpPortInput.classList.remove("connected");
  pgPortInput.classList.remove("connected");
  httpBadge.classList.remove("visible", "connected");
  pgBadge.classList.remove("visible", "connected");
  httpBadge.textContent = "Browser";
  pgBadge.textContent = "Client";
}

function updateUI() {
  if (isRunning) {
    statusIndicator.classList.add("running");
    statusText.textContent = "Running";
    toggleBtn.textContent = "Stop Relay";
    toggleBtn.classList.add("stop");
    httpPortInput.disabled = true;
    pgPortInput.disabled = true;

    const httpPort = httpPortInput.value;
    const pgPort = pgPortInput.value;

    // Update Iframe
    // force 127.0.0.1 to avoid ipv6/ipv4 mismatch on localhost
    const relayUrl = `ws://127.0.0.1:${httpPort}/agent`;

    // Determine MFE Base URL
    // In dev: use local dev server
    // In prod: use VITE_DB4APP_URL if set at build time, otherwise the public web app
    // (requires internet for assets, but the relay connection itself stays local)
    const baseUrl = (import.meta.env.VITE_DB4APP_URL as string | undefined)?.replace(/\/+$/, "")
      || (import.meta.env.DEV ? "http://localhost:5173" : "https://db4.lab4.app");
    const themeParam = themeManager.getThemeParam();

    const mfeUrl = `${baseUrl}/mfe/connection-box?relay=${encodeURIComponent(relayUrl)}&httpPort=${httpPort}&pgPort=${pgPort}&tauri=1&${themeParam}`;

    if (iframe.src !== mfeUrl) {
      iframe.src = mfeUrl;
    }
    iframeContainer.classList.remove("hidden");

    startHealthPolling();
  } else {
    statusIndicator.classList.remove("running");
    statusText.textContent = "Stopped";
    toggleBtn.textContent = "Start Relay";
    toggleBtn.classList.remove("stop");
    httpPortInput.disabled = false;
    pgPortInput.disabled = false;

    iframeContainer.classList.add("hidden");
    iframe.src = "";

    stopHealthPolling();
  }
}

async function toggleRelay() {
  toggleBtn.disabled = true;

  try {
    if (isRunning) {
      await invoke("stop_relay");
      isRunning = false;
    } else {
      const httpPort = parseInt(httpPortInput.value, 10);
      const pgPort = parseInt(pgPortInput.value, 10);

      await invoke("start_relay", { httpPort, pgPort });
      isRunning = true;
    }
  } catch (error) {
    console.error("Error:", error);
    alert(`Error: ${error}`);
  } finally {
    toggleBtn.disabled = false;
    updateUI();
  }
}


async function checkState() {
  try {
    isRunning = await invoke<boolean>("is_relay_running");
    updateUI();
  } catch (error) {
    console.error("Failed to check relay state:", error);
  }
}


function initializeMainApp() {
  // Initialize DOM references
  statusIndicator = document.getElementById("status-indicator")!;
  statusText = document.getElementById("status-text")!;
  toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
  httpPortInput = document.getElementById("http-port") as HTMLInputElement;
  pgPortInput = document.getElementById("pg-port") as HTMLInputElement;
  httpBadge = document.getElementById("http-badge")!;
  pgBadge = document.getElementById("pg-badge")!;

  iframe = document.getElementById("mfe-iframe") as HTMLIFrameElement;
  iframeContainer = document.getElementById("embedded-view")!;

  iframe.addEventListener('load', () => themeManager.syncIframe());

  // Setup event listeners
  toggleBtn.addEventListener("click", toggleRelay);
  themeManager.init('theme-toggle');
  checkState();
}

// Start the app
document.addEventListener("DOMContentLoaded", initializeMainApp);
