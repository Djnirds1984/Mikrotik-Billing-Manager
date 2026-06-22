/*
 * PisoWiFi NodeMCU ESP Firmware - Simplified Version
 * 
 * Core Features:
 * - Access Point Mode for initial setup
 * - Captive Portal for configuration
 * - WiFi Scanning to auto-fill SSID
 * - Key-based authentication for secure communication
 * - No password required for business WiFi (as requested)
 * 
 * Hardware: NodeMCU ESP8266
 * Default AP: PisoWiFi-Setup (no password)
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// Configuration structure
struct DeviceConfig {
  char ssid[32];
  char authKey[64];
  bool configured;
};

// Global variables
DeviceConfig config;
ESP8266WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

// Default AP name
const char* apName = "PisoWiFi-Setup";

void setup() {
  Serial.begin(115200);
  Serial.println("\n[PisoWiFi NodeMCU] Starting simplified version...");

  // Initialize EEPROM
  EEPROM.begin(512);
  
  // Load configuration
  loadConfig();
  
  // Start in AP mode if not configured
  if (!config.configured) {
    startAccessPoint();
    startCaptivePortal();
  } else {
    connectToWiFi();
  }
  
  // Start HTTP server
  startHTTPServer();
  
  Serial.println("[PisoWiFi NodeMCU] Ready!");
}

void loop() {
  // Handle DNS requests for captive portal
  if (!config.configured) {
    dnsServer.processNextRequest();
  }
  
  // Handle HTTP requests
  server.handleClient();
  
  // Reconnect to WiFi if disconnected
  if (config.configured && WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    delay(5000);
  }
}

// Load configuration from EEPROM
void loadConfig() {
  EEPROM.get(0, config);
  
  if (config.configured) {
    Serial.println("[Config] Loaded existing configuration");
    Serial.printf("[Config] SSID: %s\n", config.ssid);
    Serial.printf("[Config] Auth Key: %s\n", config.authKey);
  } else {
    Serial.println("[Config] No configuration found - starting in AP mode");
    config.configured = false;
    strncpy(config.ssid, "", sizeof(config.ssid));
    strncpy(config.authKey, "", sizeof(config.authKey));
    saveConfig();
  }
}

// Save configuration to EEPROM
void saveConfig() {
  EEPROM.put(0, config);
  EEPROM.commit();
  Serial.println("[Config] Configuration saved");
}

// Start Access Point mode
void startAccessPoint() {
  Serial.println("[WiFi] Starting Access Point...");
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName); // No password for business use
  
  IPAddress IP = WiFi.softAPIP();
  Serial.print("[WiFi] AP IP address: ");
  Serial.println(IP);
}

// Connect to configured WiFi network
void connectToWiFi() {
  Serial.printf("[WiFi] Connecting to %s...\n", config.ssid);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.ssid); // No password - business network
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected!");
    Serial.print("[WiFi] IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Connection failed - reverting to AP mode");
    config.configured = false;
    saveConfig();
    startAccessPoint();
    startCaptivePortal();
  }
}

// Start captive portal
void startCaptivePortal() {
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
  Serial.println("[Portal] Captive portal started");
}

// Start HTTP server
void startHTTPServer() {
  // Root page - captive portal
  server.on("/", HTTP_GET, handleRoot);
  
  // WiFi scan endpoint
  server.on("/scan", HTTP_GET, handleWiFiScan);
  
  // Configuration endpoints
  server.on("/config", HTTP_GET, handleGetConfig);
  server.on("/config", HTTP_POST, handleSetConfig);
  
  // Device information
  server.on("/info", HTTP_GET, handleDeviceInfo);
  
  server.begin();
  Serial.println("[HTTP] Server started");
}

// Handler functions
static const char INDEX_HTML[] PROGMEM = R"=====(
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PisoWiFi Setup</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f0f0f0; }
        .container { max-width: 500px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
        input, select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; font-size: 16px; }
        button { background: #007cba; color: white; padding: 15px 20px; border: none; border-radius: 5px; cursor: pointer; width: 100%; font-size: 16px; font-weight: bold; }
        button:hover { background: #005a87; }
        .status { padding: 15px; border-radius: 5px; margin: 15px 0; text-align: center; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        .network-btn { background: #28a745; margin: 5px 0; }
        .network-btn:hover { background: #218838; }
        #networkList { margin-top: 10px; max-height: 300px; overflow-y: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📡 PisoWiFi NodeMCU Setup</h1>
        <div id="status"></div>
        
        <form id="setupForm">
            <div class="form-group">
                <label for="ssid">WiFi Network (SSID):</label>
                <input type="text" id="ssid" name="ssid" required placeholder="Select from scanned networks or enter manually">
                <button type="button" onclick="scanNetworks()">🔍 Scan for Networks</button>
                <div id="networkList"></div>
            </div>
            
            <div class="form-group">
                <label for="authKey">Authentication Key:</label>
                <input type="text" id="authKey" name="authKey" required placeholder="Enter your PisoWiFi system key">
            </div>
            
            <button type="submit">💾 Save Configuration</button>
        </form>
        
        <hr>
        <h3>Device Information</h3>
        <div id="deviceInfo"></div>
        <button onclick="refreshInfo()">🔄 Refresh</button>
    </div>

    <script>
        // Load current configuration on page load
        window.onload = function() {
            loadCurrentConfig();
            refreshInfo();
        };

        function scanNetworks() {
            const status = document.getElementById('status');
            status.innerHTML = '<div class="info">Scanning for networks...</div>';
            
            fetch('/scan')
                .then(response => response.json())
                .then(data => {
                    const networkList = document.getElementById('networkList');
                    networkList.innerHTML = '<h4>Available Networks:</h4>';
                    
                    data.networks.forEach(network => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'network-btn';
                        btn.textContent = `${network.ssid} (${network.rssi}dBm) ${network.encrypted ? '🔒' : '🔓'}`;
                        btn.onclick = () => selectNetwork(network.ssid);
                        networkList.appendChild(btn);
                    });
                    
                    status.innerHTML = '<div class="success">Network scan complete!</div>';
                    setTimeout(() => {
                        status.innerHTML = '';
                    }, 3000);
                })
                .catch(error => {
                    status.innerHTML = `<div class="error">Error scanning networks: ${error.message}</div>`;
                });
        }

        function selectNetwork(ssid) {
            document.getElementById('ssid').value = ssid;
            document.getElementById('networkList').innerHTML = '';
        }

        function loadCurrentConfig() {
            fetch('/config')
                .then(response => response.json())
                .then(data => {
                    if (data.configured) {
                        document.getElementById('ssid').value = data.ssid || '';
                        document.getElementById('authKey').value = data.authKey || '';
                    }
                })
                .catch(error => console.error('Error loading config:', error));
        }

        function refreshInfo() {
            fetch('/info')
                .then(response => response.json())
                .then(data => {
                    const infoDiv = document.getElementById('deviceInfo');
                    infoDiv.innerHTML = `
                        <p><strong>Device MAC:</strong> ${data.mac}</p>
                        <p><strong>IP Address:</strong> ${data.ip}</p>
                        <p><strong>Chip ID:</strong> ${data.chipId}</p>
                        <p><strong>Free Memory:</strong> ${data.freeHeap} bytes</p>
                        <p><strong>Uptime:</strong> ${data.uptime} seconds</p>
                        <p><strong>Configured:</strong> ${data.configured ? 'Yes' : 'No (AP Mode)'}</p>
                    `;
                })
                .catch(error => console.error('Error getting device info:', error));
        }

        document.getElementById('setupForm').onsubmit = function(e) {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const configData = {
                ssid: formData.get('ssid'),
                authKey: formData.get('authKey')
            };
            
            // Validate inputs
            if (!configData.ssid || !configData.authKey) {
                document.getElementById('status').innerHTML = '<div class="error">Please fill in all fields</div>';
                return;
            }
            
            const status = document.getElementById('status');
            status.innerHTML = '<div class="info">Saving configuration...</div>';
            
            fetch('/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(configData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    status.innerHTML = '<div class="success">Configuration saved! Device will reboot and connect to your network...</div>';
                    // Refresh info to show new status
                    setTimeout(refreshInfo, 2000);
                } else {
                    status.innerHTML = `<div class="error">Error: ${data.error}</div>`;
                }
            })
            .catch(error => {
                status.innerHTML = `<div class="error">Error saving configuration: ${error.message}</div>`;
            });
        };
    </script>
</body>
</html>
)=====";

void handleRoot() {
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleWiFiScan() {
  Serial.println("[HTTP] WiFi scan requested");
  
  int n = WiFi.scanNetworks();
  DynamicJsonDocument doc(2048);
  JsonArray networks = doc.createNestedArray("networks");
  
  for (int i = 0; i < n; i++) {
    JsonObject network = networks.createNestedObject();
    network["ssid"] = WiFi.SSID(i);
    network["rssi"] = WiFi.RSSI(i);
    network["encrypted"] = WiFi.encryptionType(i) != ENC_TYPE_NONE;
  }
  
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void handleGetConfig() {
  DynamicJsonDocument doc(512);
  doc["configured"] = config.configured;
  doc["ssid"] = config.ssid;
  doc["authKey"] = config.authKey;
  
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void handleSetConfig() {
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"error\":\"No data received\"}");
    return;
  }
  
  String json = server.arg("plain");
  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, json);
  
  if (error) {
    server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }
  
  // Validate authentication key
  const char* authKey = doc["authKey"];
  if (!authKey || strlen(authKey) == 0) {
    server.send(400, "application/json", "{\"error\":\"Authentication key required\"}");
    return;
  }
  
  // Update configuration
  strncpy(config.ssid, doc["ssid"] | "", sizeof(config.ssid) - 1);
  strncpy(config.authKey, authKey, sizeof(config.authKey) - 1);
  config.configured = true;
  
  saveConfig();
  
  server.send(200, "application/json", "{\"success\":true}");
  
  // Reboot after a delay to connect to new network
  delay(1000);
  ESP.restart();
}

void handleDeviceInfo() {
  DynamicJsonDocument doc(512);
  doc["mac"] = WiFi.macAddress();
  doc["ip"] = config.configured ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
  doc["chipId"] = ESP.getChipId();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptime"] = millis() / 1000;
  doc["configured"] = config.configured;
  
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}