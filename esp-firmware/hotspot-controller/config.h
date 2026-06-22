#ifndef CONFIG_H
#define CONFIG_H

// ============================================================
// Hotspot Controller - ESP Coinslot Firmware Configuration
// Based on AJC Sub-Vendo NodeMCU v2.0 patterns
// ============================================================

// --- Firmware Version ---
#define FIRMWARE_VERSION        "2.0"
#define FIRMWARE_NAME           "AJC Hotspot Controller"

// --- WiFi Configuration ---
#define DEFAULT_AP_SSID         "AJC-Hotspot-Setup"
#define DEFAULT_AP_PASSWORD     ""

// --- Timing ---
#define REGISTRATION_INTERVAL   10000   // Heartbeat every 10s (matches existing)
#define RELAY_HOLD_MS           3000    // Relay hold time after coin pulse
#define PULSE_DEBOUNCE_MS       30      // 30ms debounce (matches existing for multi-coin)
#define COIN_WINDOW_MS          500     // 500ms inactivity before sending (matches existing)
#define WIFI_RECONNECT_INTERVAL 15000   // WiFi reconnect check interval

// --- Hardware Pin Configuration ---
// Defaults match existing firmware: Coin=D6(GPIO12), Relay=D5(GPIO14)
#define DEFAULT_COIN_GPIO       12
#define DEFAULT_RELAY_GPIO      14

// Status LED (D0 = GPIO16)
#define LED_STATUS_PIN          16

// --- EEPROM Configuration ---
#define EEPROM_SIZE             512
#define EEPROM_SSID_ADDR        0
#define EEPROM_KEY_ADDR         32
#define EEPROM_CONFIGURED_ADDR  64
#define EEPROM_COIN_PIN_ADDR    68
#define EEPROM_RELAY_PIN_ADDR   69
#define EEPROM_PIN_MARKER_ADDR  70
#define EEPROM_PIN_MARKER_VALUE 0xA5

// Force AP mode pin (D3/GPIO0 grounded during boot)
#define FORCE_SETUP_PIN         0

// --- Allowed GPIO Pins ---
// ESP8266 safe GPIOs for input (coin pulse)
// 5=D1, 4=D2, 0=D3, 2=D4, 14=D5, 12=D6, 13=D7, 15=D8
// ESP8266 safe GPIOs for output (relay) adds GPIO16=D0

// --- Web Server ---
#define WEB_SERVER_PORT         80
#define DNS_PORT                53

// --- API Endpoints (on gateway IP) ---
#define API_REGISTER_PATH       "/api/nodemcu/register"
#define API_PULSE_PATH          "/api/nodemcu/pulse"

// --- License/Status Flags ---
// These mirror the existing firmware's registration flow
// The panel returns: { status: "accepted", licensed: true/false, frozen: true/false }

#endif // CONFIG_H
