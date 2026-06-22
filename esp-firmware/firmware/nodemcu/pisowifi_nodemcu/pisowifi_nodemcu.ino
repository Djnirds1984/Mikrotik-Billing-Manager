/*
 * PisoWiFi NodeMCU ESP Firmware - Fixed SSID Visibility
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// Configuration structure
struct Config {
  uint32_t magic;
  char ssid[32];
  char password[32];
  char authenticationKey[64];
  bool configured;
  int coinPins[4];
  int denominations[4];
  bool slotEnabled[4];
};

// Global variables
Config config;
const uint32_t CONFIG_MAGIC = 0x150CAFE; 
ESP8266WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

// Default configuration
const char* defaultSSID = "PisoWiFi-Setup";
const char* defaultPassword = "";
const int defaultCoinPins[4] = {12, 5, 4, 14}; // D6, D1, D2, D5
const int defaultDenominations[4] = {1, 5, 10, 1};
const bool defaultSlotEnabled[4] = {true, false, false, false};

// Coin detection variables
volatile bool coinDetected[4] = {false, false, false, false};
unsigned long lastInterruptTime[4] = {0, 0, 0, 0};
const unsigned long debounceDelay = 200; 

// EEPROM addresses
#define CONFIG_ADDR 0

// Pin D3 (GPIO 0) can be used to force AP mode if grounded during boot
const int FORCE_SETUP_PIN = 0; 

// Forward declarations
void IRAM_ATTR coinInterrupt();
void loadConfig();
void saveConfig();
void resetToDefaults();
void startAccessPoint();
void startCaptivePortal();
void connectToWiFi();
void startHTTPServer();
void initGPIO();
void processCoinDetections();

void setup() {
  Serial.begin(115200);
  delay(1000); // Allow system to stabilize
  Serial.println("\n[PisoWiFi NodeMCU] Starting...");

  // Initialize EEPROM
  EEPROM.begin(512);
  
  // Clear previous WiFi state to prevent crash loops from SDK
  WiFi.persistent(false);
  WiFi.disconnect(true);
  delay(100);
  
  // Load configuration
  loadConfig();
  
  // Start in AP mode if not configured
  // Check magic number and configured flag
  if (!config.configured || config.magic != CONFIG_MAGIC) {
    if (config.magic != CONFIG_MAGIC) {
        Serial.println("[Config] Magic mismatch, resetting defaults...");
        // Reset defaults logic is in loadConfig else branch effectively
        // but we ensure we are in a clean state
    }
    startAccessPoint();
    startCaptivePortal();
  } else {
    connectToWiFi();
  }
  
  // Start HTTP server
  startHTTPServer();
  
  // Initialize GPIO pins LAST to prevent interrupts during startup
  initGPIO();
  
  Serial.println("[PisoWiFi NodeMCU] Ready!");
}

void loop() {
  if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
    dnsServer.processNextRequest();
  }
  
  server.handleClient();
  processCoinDetections();
  
  // Reconnect logic
  static unsigned long lastReconnectCheck = 0;
  if (config.configured && WiFi.status() != WL_CONNECTED && millis() - lastReconnectCheck > 15000) {
    Serial.println("[WiFi] Connection lost, retrying...");
    connectToWiFi();
    lastReconnectCheck = millis();
  }
}

void loadConfig() {
  EEPROM.get(CONFIG_ADDR, config);
  
  if (config.magic != CONFIG_MAGIC) {
    Serial.println("[Config] No valid config found. Resetting defaults.");
    resetToDefaults();
  } else {
    Serial.printf("[Config] Loaded. Target SSID: %s\n", config.ssid);
  }
}

void resetToDefaults() {
    config.magic = CONFIG_MAGIC;
    memset(config.ssid, 0, sizeof(config.ssid));
    memset(config.password, 0, sizeof(config.password));
    memset(config.authenticationKey, 0, sizeof(config.authenticationKey));
    config.configured = false;
    
    for (int i = 0; i < 4; i++) {
      config.coinPins[i] = defaultCoinPins[i];
      config.denominations[i] = defaultDenominations[i];
      config.slotEnabled[i] = defaultSlotEnabled[i];
    }
    saveConfig();
}

void saveConfig() {
  EEPROM.put(CONFIG_ADDR, config);
  EEPROM.commit();
}

void initGPIO() {
  for (int i = 0; i < 4; i++) {
    if (config.slotEnabled[i]) {
      pinMode(config.coinPins[i], INPUT_PULLUP);
      attachInterrupt(digitalPinToInterrupt(config.coinPins[i]), coinInterrupt, FALLING);
    }
  }
  pinMode(16, OUTPUT); // D0 Status LED
  digitalWrite(16, HIGH);
}

// Start Access Point mode
void startAccessPoint() {
  Serial.println("[WiFi] Starting Access Point...");
  
  // Force AP mode and disconnect any STA
  WiFi.mode(WIFI_AP);
  WiFi.softAPdisconnect(true);
  delay(100);
  
  // Use a unique SSID part to avoid conflicts? For now stick to default
  bool result = WiFi.softAP(defaultSSID, defaultPassword);
  
  if (result) {
      IPAddress IP = WiFi.softAPIP();
      Serial.print("[WiFi] AP IP address: ");
      Serial.println(IP);
  } else {
      Serial.println("[WiFi] Failed to start AP!");
  }
}

void connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.ssid, config.password);
  
  Serial.printf("[WiFi] Connecting to %s", config.ssid);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected!");
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Connection Fail. Switching to AP mode for reconfiguration.");
    startAccessPoint();
    startCaptivePortal();
  }
}

void startCaptivePortal() {
  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
  Serial.println("[DNS] Captive Portal DNS Started.");
}

void handleSetConfig() {
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"error\":\"No data\"}");
    return;
  }
  
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, server.arg("plain"));
  
  if (error) {
    server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }
  
  strncpy(config.ssid, doc["ssid"] | "", sizeof(config.ssid) - 1);
  strncpy(config.password, doc["password"] | "", sizeof(config.password) - 1);
  strncpy(config.authenticationKey, doc["authenticationKey"] | "", sizeof(config.authenticationKey) - 1);
  config.configured = true;

  JsonArray pins = doc["coinPins"];
  for (int i = 0; i < 4 && i < pins.size(); i++) {
    config.coinPins[i] = pins[i];
    config.denominations[i] = doc["denominations"][i];
    config.slotEnabled[i] = doc["slotEnabled"][i];
  }

  saveConfig();
  server.send(200, "application/json", "{\"success\":true}");
  delay(1000);
  ESP.restart();
}

const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head><title>PisoWiFi Setup</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#f0f2f5}.container{max-width:400px;margin:0 auto;background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}h2{text-align:center;color:#333}.form-group{margin-bottom:15px}label{display:block;margin-bottom:5px;color:#666}input{width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box}button{width:100%;padding:10px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;font-size:16px}button:hover{background:#0056b3}#status{margin-top:15px;text-align:center}.scan-btn{background:#28a745;margin-bottom:15px}.scan-btn:hover{background:#218838}#networks{list-style:none;padding:0;margin-bottom:15px;max-height:200px;overflow-y:auto;display:none}#networks li{padding:8px;border-bottom:1px solid #eee;cursor:pointer}#networks li:hover{background:#f8f9fa}</style></head><body><div class="container"><h2>PisoWiFi Configuration</h2><button type="button" class="scan-btn" onclick="scanNetworks()">Scan Networks</button><ul id="networks"></ul><form id="configForm" onsubmit="saveConfig(event)"><div class="form-group"><label>WiFi SSID</label><input type="text" id="ssid" name="ssid" required></div><div class="form-group"><label>WiFi Password</label><input type="password" id="password" name="password"></div><div class="form-group"><label>Authentication Key</label><input type="text" id="authenticationKey" name="authenticationKey"></div><button type="submit">Save & Reboot</button></form><div id="status"></div></div><script>function scanNetworks(){const l=document.getElementById('networks');l.style.display='block';l.innerHTML='<li>Scanning...</li>';fetch('/scan').then(r=>r.json()).then(d=>{l.innerHTML='';if(d.networks.length===0){l.innerHTML='<li>No networks found</li>';return}d.networks.forEach(n=>{const i=document.createElement('li');i.textContent=`${n.ssid} (${n.rssi} dBm)`;i.onclick=()=>{document.getElementById('ssid').value=n.ssid;document.getElementById('password').focus();l.style.display='none'};l.appendChild(i)})}).catch(e=>{l.innerHTML='<li>Error scanning</li>'})}function saveConfig(e){e.preventDefault();const s=document.getElementById('status');s.textContent='Saving...';const d={ssid:document.getElementById('ssid').value,password:document.getElementById('password').value,authenticationKey:document.getElementById('authenticationKey').value};fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json()).then(d=>{if(d.success){s.textContent='Saved! Rebooting...';s.style.color='green'}else{s.textContent='Error saving';s.style.color='red'}}).catch(e=>{s.textContent='Error: '+e.message;s.style.color='red'})}fetch('/config').then(r=>r.json()).then(d=>{if(d.ssid)document.getElementById('ssid').value=d.ssid;if(d.authenticationKey)document.getElementById('authenticationKey').value=d.authenticationKey});</script></body></html>
)rawliteral";

void handleRoot() { server.send(200, "text/html", index_html); }

void handleWiFiScan() {
  int n = WiFi.scanNetworks();
  String json = "{\"networks\":[";
  for (int i = 0; i < n; ++i) {
    if (i) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]}";
  server.send(200, "application/json", json);
}

void handleGetConfig() {
  DynamicJsonDocument doc(512);
  doc["ssid"] = config.ssid;
  doc["authenticationKey"] = config.authenticationKey;
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}
void handleCoinDetection() { server.send(200, "ok"); }
void handleGetCoins() { server.send(200, "application/json", "{\"coins\":[]}"); }
void handleDeviceInfo() { server.send(200, "application/json", "{\"status\":\"ok\"}"); }
void handleReboot() { ESP.restart(); }
void handleResetConfig() { resetToDefaults(); ESP.restart(); }

void startHTTPServer() {
  server.on("/", handleRoot);
  server.on("/scan", handleWiFiScan);
  server.on("/config", HTTP_GET, handleGetConfig);
  server.on("/config", HTTP_POST, handleSetConfig);
  server.on("/reset", handleResetConfig);
  server.begin();
}

void IRAM_ATTR coinInterrupt() {
  for (int i = 0; i < 4; i++) {
    if (config.slotEnabled[i] && digitalRead(config.coinPins[i]) == LOW) {
      unsigned long now = millis();
      if (now - lastInterruptTime[i] > debounceDelay) {
        coinDetected[i] = true;
        lastInterruptTime[i] = now;
      }
    }
  }
}

void processCoinDetections() {
  for (int i = 0; i < 4; i++) {
    if (coinDetected[i]) {
      Serial.printf("Coin slot %d detected!\n", i+1);
      coinDetected[i] = false;
    }
  }
}