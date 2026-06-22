/*
 * NodeMCU ESP8266 Firmware for PisoWiFi Multi-Coin Slot System (Sub-Vendo Edition)
 * 
 * Features:
 * - Creates hotspot access point for initial setup
 * - Captive portal for configuration (SSID, System Key)
 * - Auto-registration with Main Controller via MAC Address
 * - Pulse detection for coin acceptors
 * - Real-time pulse reporting to Main Controller
 * 
 * Hardware:
 * - NodeMCU ESP8266
 * - Coin acceptor connected to GPIO D6 (Pulse Signal)
 * 
 * Version: 2.0
 * Author: PisoWiFi Team
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266HTTPUpdateServer.h>

// EEPROM addresses
#define EEPROM_SSID_ADDR 0
#define EEPROM_KEY_ADDR 32
#define EEPROM_CONFIGURED_ADDR 64

#define EEPROM_COIN_PIN_ADDR 68
#define EEPROM_RELAY_PIN_ADDR 69
#define EEPROM_PIN_MARKER_ADDR 70
#define EEPROM_PIN_MARKER_VALUE 0xA5

// Default values
#define DEFAULT_AP_SSID "AJC-SubVendo-Setup"
#define DEFAULT_AP_PASSWORD ""
#define REGISTRATION_INTERVAL 10000 // 10 seconds heartbeat

// Defaults (physical pin labels: Coin=D6, Relay=D5)
#define DEFAULT_COIN_GPIO 12
#define DEFAULT_RELAY_GPIO 14

// Global variables
String configuredSSID = "";
String systemKey = "";
bool isConfigured = false;
bool isAccepted = false;
bool isLicensed = false;
unsigned long lastRegistrationAttempt = 0;
volatile int pendingPulses = 0;
volatile unsigned long lastPulseTime = 0;
volatile unsigned long lastRelayTriggerTime = 0;

uint8_t coinPinGpio = DEFAULT_COIN_GPIO;
uint8_t relayPinGpio = DEFAULT_RELAY_GPIO;

const unsigned long RELAY_HOLD_MS = 3000;

// Web server and DNS server
ESP8266WebServer server(80);
ESP8266HTTPUpdateServer httpUpdater;
DNSServer dnsServer;
const byte DNS_PORT = 53;

// Function prototypes
void setupAccessPoint();
void setupCaptivePortal();
void setupUpdateServer();
void handleRoot();
void handleScan();
void handleConfigure();
void handleGetPins();
void handleSetPins();
void handleCoinPulse();
void saveConfiguration();
void loadConfiguration();
void connectToPisoWiFi();
void registerWithServer();
void sendPulse(int denomination);

bool isAllowedGpio(int gpio);
bool isAllowedCoinGpio(int gpio);
void savePinConfiguration();
void loadPinConfiguration();

void setup() {
  Serial.begin(115200);
  Serial.println("\n--- AJC Sub-Vendo NodeMCU v2.0 ---");

  // Initialize EEPROM
  EEPROM.begin(512);

  // Load configuration from EEPROM
  loadConfiguration();
  loadPinConfiguration();

  // Set up WiFi properties
  WiFi.setAutoReconnect(true);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);

  pinMode(relayPinGpio, OUTPUT);
  digitalWrite(relayPinGpio, LOW);

  pinMode(coinPinGpio, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(coinPinGpio), handleCoinPulse, FALLING);

  // If not configured, start access point
  setupUpdateServer();
  if (!isConfigured) {
    setupAccessPoint();
    setupCaptivePortal();
  } else {
    connectToPisoWiFi();
  }
}

void setupUpdateServer() {
  httpUpdater.setup(&server, "/update");
  server.on("/", handleRoot);
  server.on("/scan", handleScan);
  server.on("/configure", handleConfigure);
  server.on("/api/pins", HTTP_GET, handleGetPins);
  server.on("/api/pins", HTTP_POST, handleSetPins);
  server.onNotFound(handleRoot);
  server.begin();
  Serial.println("HTTP Server & Update Server started");
}

void loop() {
  if (!isConfigured) {
    dnsServer.processNextRequest();
  } else {
    unsigned long relayNow = millis();
    unsigned long lastRelay = lastRelayTriggerTime;
    if (isAccepted && isLicensed && lastRelay != 0 && (relayNow - lastRelay) < RELAY_HOLD_MS) {
      digitalWrite(relayPinGpio, HIGH);
    } else {
      digitalWrite(relayPinGpio, LOW);
    }

    // Accumulate pulses and send total after 500ms of inactivity
    if (isAccepted && isLicensed && pendingPulses > 0 && millis() - lastPulseTime > 500) {
      int totalToSend = pendingPulses;
      pendingPulses = 0; // Reset before sending to avoid race conditions
      sendPulse(totalToSend);
    }

    // Handle periodic registration/auth check if not accepted
    if (WiFi.status() == WL_CONNECTED && (!isAccepted || !isLicensed || millis() - lastRegistrationAttempt > REGISTRATION_INTERVAL)) {
      registerWithServer();
      lastRegistrationAttempt = millis();
    }
  }
  server.handleClient();
  
  // Handle reconnection if needed
  if (isConfigured && WiFi.status() != WL_CONNECTED) {
    connectToPisoWiFi();
    delay(5000);
  }
}

void setupAccessPoint() {
  WiFi.mode(isConfigured ? WIFI_AP_STA : WIFI_AP);
  WiFi.softAP(DEFAULT_AP_SSID, DEFAULT_AP_PASSWORD);
  Serial.println("Setup AP: " + String(DEFAULT_AP_SSID));
  Serial.println("IP: " + WiFi.softAPIP().toString());
}

void setupCaptivePortal() {
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
  server.onNotFound(handleRoot);
}

void handleRoot() {
  String html = R"=====(
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AJC Sub-Vendo Setup</title>
    <style>
        body { font-family: -apple-system, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc; color: #1e293b; }
        .card { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 24px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        h1 { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.025em; margin-bottom: 20px; text-align: center; }
        .field { margin-bottom: 20px; }
        label { display: block; font-size: 11px; font-weight: 900; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.1em; }
        input { width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 14px; box-sizing: border-box; }
        button { background: #0f172a; color: white; padding: 14px; border: none; border-radius: 12px; width: 100%; font-weight: 900; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
        button:hover { background: #000; transform: translateY(-1px); }
        .scan-btn { background: #3b82f6; margin-bottom: 15px; }
        .net-list { background: #f1f5f9; border-radius: 12px; margin-bottom: 20px; max-height: 150px; overflow-y: auto; font-size: 13px; }
        .net-item { padding: 12px; border-bottom: 1px solid #e2e8f0; cursor: pointer; }
        .status { margin-top: 20px; padding: 15px; border-radius: 12px; font-size: 12px; font-weight: 700; text-align: center; display: none; }
    </style>
</head>
<body>
    <div class="card">
        <h1>📡 Sub-Vendo Setup</h1>
        <button class="scan-btn" onclick="scan()">Scan for Networks</button>
        <div id="nets" class="net-list"></div>
        <form id="form">
            <div class="field">
                <label>PisoWiFi SSID</label>
                <input type="text" id="ssid" name="ssid" required>
            </div>
            <div class="field">
                <label>System Auth Key</label>
                <input type="password" id="key" name="key" required>
            </div>
            <button type="submit">Connect to System</button>
        </form>
        <div id="stat" class="status"></div>
    </div>
    <script>
        function scan() {
            const btn = document.querySelector('.scan-btn');
            btn.innerText = 'Scanning...';
            fetch('/scan').then(r => r.json()).then(d => {
                const list = document.getElementById('nets');
                list.innerHTML = d.networks.map(n => `<div class="net-item" onclick="document.getElementById('ssid').value='${n.ssid}'">${n.ssid}</div>`).join('');
                btn.innerText = 'Scan Again';
            });
        }
        document.getElementById('form').onsubmit = (e) => {
            e.preventDefault();
            const stat = document.getElementById('stat');
            stat.style.display = 'block';
            stat.innerText = 'Saving...';
            fetch('/configure', { method: 'POST', body: new FormData(e.target) })
                .then(r => r.json()).then(d => {
                    stat.innerText = d.message;
                    if(d.success) setTimeout(() => location.reload(), 2000);
                });
        };
    </script>
</body>
</html>
)=====";
  server.send(200, "text/html", html);
}

void handleScan() {
  int n = WiFi.scanNetworks();
  String json = "{\"networks\":[";
  for (int i = 0; i < n; i++) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\"}";
  }
  json += "]}";
  server.send(200, "application/json", json);
}

void handleConfigure() {
  if (server.hasArg("ssid") && server.hasArg("key")) {
    configuredSSID = server.arg("ssid");
    systemKey = server.arg("key");
    saveConfiguration();
    server.send(200, "application/json", "{\"success\":true,\"message\":\"Connecting...\"}");
    delay(1000);
    ESP.restart();
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"Missing fields\"}");
  }
}

void handleGetPins() {
  String json = "{\"success\":true,\"coinPin\":" + String(coinPinGpio) + ",\"relayPin\":" + String(relayPinGpio) + "}";
  server.send(200, "application/json", json);
}

void handleSetPins() {
  if (!server.hasArg("key") || server.arg("key") != systemKey) {
    server.send(401, "application/json", "{\"success\":false,\"message\":\"Unauthorized\"}");
    return;
  }

  if (!server.hasArg("coinPin") || !server.hasArg("relayPin")) {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"Missing pins\"}");
    return;
  }

  int nextCoin = server.arg("coinPin").toInt();
  int nextRelay = server.arg("relayPin").toInt();

  if (!isAllowedCoinGpio(nextCoin) || !isAllowedGpio(nextRelay)) {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"Invalid pin mapping\"}");
    return;
  }

  coinPinGpio = (uint8_t)nextCoin;
  relayPinGpio = (uint8_t)nextRelay;
  savePinConfiguration();

  server.send(200, "application/json", "{\"success\":true,\"message\":\"Rebooting\"}");
  delay(500);
  ESP.restart();
}

void ICACHE_RAM_ATTR handleCoinPulse() {
  if (!isAccepted || !isLicensed) return;
  unsigned long now = millis();
  if (now - lastPulseTime > 30) { // Reduced debounce to 30ms for multi-coin accuracy
    pendingPulses++;
    lastPulseTime = now;
    lastRelayTriggerTime = now;
  }
}

void registerWithServer() {
  WiFiClient client;
  HTTPClient http;
  String url = "http://" + WiFi.gatewayIP().toString() + "/api/nodemcu/register";
  
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    String payload = "{\"macAddress\":\"" + WiFi.macAddress() + "\",\"ipAddress\":\"" + WiFi.localIP().toString() + "\",\"authenticationKey\":\"" + systemKey + "\"}";
    int code = http.POST(payload);
    
    if (code == 200) {
      String response = http.getString();
      if (response.indexOf("\"status\":\"accepted\"") != -1) {
        isAccepted = true;
        Serial.println("Registration: ACCEPTED");
      } else {
        isAccepted = false;
        Serial.println("Registration: PENDING ADMIN APPROVAL");
      }

      if (response.indexOf("\"frozen\":true") != -1 || response.indexOf("\"licensed\":false") != -1) {
        isLicensed = false;
        pendingPulses = 0;
        lastRelayTriggerTime = 0;
        Serial.println("License: FROZEN / NO LICENSE");
      } else {
        isLicensed = isAccepted;
        if (isLicensed) Serial.println("License: OK");
      }
    }
    http.end();
  }
}

void sendPulse(int denomination) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!isAccepted || !isLicensed) return;
  
  WiFiClient client;
  HTTPClient http;
  String url = "http://" + WiFi.gatewayIP().toString() + "/api/nodemcu/pulse";
  
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    String payload = "{\"macAddress\":\"" + WiFi.macAddress() + "\",\"slotId\":1,\"denomination\":" + String(denomination) + "}";
    int code = http.POST(payload);
    if (code == 200) {
      Serial.println("Pulse Reported: " + String(denomination));
    } else if (code == 403) {
      isLicensed = false;
      pendingPulses = 0;
      lastRelayTriggerTime = 0;
      Serial.println("Pulse rejected (license). Device frozen.");
    }
    http.end();
  }
}

void saveConfiguration() {
  for (int i = 0; i < configuredSSID.length() && i < 32; i++) EEPROM.write(EEPROM_SSID_ADDR + i, configuredSSID[i]);
  EEPROM.write(EEPROM_SSID_ADDR + min((int)configuredSSID.length(), 31), '\0');
  for (int i = 0; i < systemKey.length() && i < 32; i++) EEPROM.write(EEPROM_KEY_ADDR + i, systemKey[i]);
  EEPROM.write(EEPROM_KEY_ADDR + min((int)systemKey.length(), 31), '\0');
  EEPROM.write(EEPROM_CONFIGURED_ADDR, 1);
  EEPROM.commit();
}

void loadConfiguration() {
  isConfigured = (EEPROM.read(EEPROM_CONFIGURED_ADDR) == 1);
  if (isConfigured) {
    char s[32], k[32];
    for (int i = 0; i < 32; i++) { s[i] = EEPROM.read(EEPROM_SSID_ADDR + i); if (s[i] == '\0') break; }
    for (int i = 0; i < 32; i++) { k[i] = EEPROM.read(EEPROM_KEY_ADDR + i); if (k[i] == '\0') break; }
    configuredSSID = String(s);
    systemKey = String(k);
  }
}

void savePinConfiguration() {
  EEPROM.write(EEPROM_COIN_PIN_ADDR, coinPinGpio);
  EEPROM.write(EEPROM_RELAY_PIN_ADDR, relayPinGpio);
  EEPROM.write(EEPROM_PIN_MARKER_ADDR, EEPROM_PIN_MARKER_VALUE);
  EEPROM.commit();
}

void loadPinConfiguration() {
  if (EEPROM.read(EEPROM_PIN_MARKER_ADDR) == EEPROM_PIN_MARKER_VALUE) {
    coinPinGpio = EEPROM.read(EEPROM_COIN_PIN_ADDR);
    relayPinGpio = EEPROM.read(EEPROM_RELAY_PIN_ADDR);
    if (!isAllowedCoinGpio(coinPinGpio)) coinPinGpio = DEFAULT_COIN_GPIO;
    if (!isAllowedGpio(relayPinGpio)) relayPinGpio = DEFAULT_RELAY_GPIO;
  } else {
    coinPinGpio = DEFAULT_COIN_GPIO;
    relayPinGpio = DEFAULT_RELAY_GPIO;
  }
}

bool isAllowedCoinGpio(int gpio) {
  switch (gpio) {
    case 5:
    case 4:
    case 0:
    case 2:
    case 14:
    case 12:
    case 13:
    case 15:
      return true;
    default:
      return false;
  }
}

bool isAllowedGpio(int gpio) {
  switch (gpio) {
    case 16:
    case 5:
    case 4:
    case 0:
    case 2:
    case 14:
    case 12:
    case 13:
    case 15:
      return true;
    default:
      return false;
  }
}

void connectToPisoWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  if (isConfigured) {
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(configuredSSID.c_str());
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.begin(configuredSSID.c_str());
  }
  
  Serial.print("Connecting to " + configuredSSID);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print(".");
    tries++;
    server.handleClient(); // Keep setup portal responsive during connection attempts
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
    WiFi.mode(WIFI_STA); // Disable AP once connected to save resources
    registerWithServer();
  } else {
    Serial.println("\nConnection failed. Persistent retry enabled.");
    setupAccessPoint(); // Keep AP active for setup/debug
    setupCaptivePortal();
  }
}
