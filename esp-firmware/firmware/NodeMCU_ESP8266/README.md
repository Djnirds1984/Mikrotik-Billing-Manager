# NodeMCU ESP8266 Firmware for PisoWiFi

This firmware enables NodeMCU ESP8266 modules to function as additional coin slots in the PisoWiFi system.

## Features

- **Hotspot Access Point**: Creates a WiFi hotspot for initial setup (no password)
- **Captive Portal**: Web-based configuration interface
- **WiFi Scanning**: Automatically detect nearby PisoWiFi networks
- **System Authentication**: Secure authentication with system key
- **Coin Detection**: Detects coin pulses on GPIO D6
- **Persistent Configuration**: Stores settings in EEPROM

## Hardware Requirements

- NodeMCU ESP8266
- Coin acceptor module
- Jumper wires
- Micro USB cable for programming

## Hardware Connections

Connect the coin acceptor to the NodeMCU:
- **Coin Acceptor Signal Wire** → **GPIO D6** (NodeMCU pin)
- **Coin Acceptor Ground** → **GND** (NodeMCU pin)
- **Coin Acceptor VCC** → **3.3V** or **5V** (depending on coin acceptor specifications)

## Installation

### 1. Install Arduino IDE
Download and install the Arduino IDE from [arduino.cc](https://www.arduino.cc/en/software)

### 2. Install ESP8266 Board Package
1. Open Arduino IDE
2. Go to `File` → `Preferences`
3. Add this URL to "Additional Board Manager URLs":
   ```
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
4. Go to `Tools` → `Board` → `Boards Manager`
5. Search for "esp8266" and install "ESP8266 by ESP8266 Community"

### 3. Install Required Libraries
The firmware uses built-in libraries, so no additional libraries need to be installed.

### 4. Flash the Firmware
1. Open the `NodeMCU_ESP8266.ino` file in Arduino IDE
2. Select board: `Tools` → `Board` → `ESP8266 Boards` → `NodeMCU 1.0 (ESP-12E Module)`
3. Select port: `Tools` → `Port` → (select your NodeMCU port)
4. Click the Upload button (→) to flash the firmware

## Initial Setup

### 1. Power Up the NodeMCU
After flashing, power up the NodeMCU. It will automatically create a WiFi hotspot.

### 2. Connect to the Hotspot
- **SSID**: `PisoWiFi-Setup`
- **Password**: None (open network)

### 3. Configure the Device
1. Open a web browser and navigate to any website (e.g., `http://example.com`)
2. The captive portal should automatically appear
3. Click "Scan for PisoWiFi Networks" to detect nearby PisoWiFi hotspots
4. Select your PisoWiFi network from the list
5. Enter the **System Authentication Key** (obtained from your PisoWiFi admin panel)
6. Optionally, set a custom Device ID
7. Click "Save Configuration"

### 4. Device Registration
The NodeMCU will restart and attempt to connect to your PisoWiFi network. Once connected, it will appear in the admin panel as a pending device waiting for approval.

## System Integration

### Admin Panel Integration
1. Navigate to the Hardware section in your PisoWiFi admin panel
2. Select the "Multi-NodeMCU" tab
3. Pending devices will appear with an "Accept" button
4. Click "Accept" to approve the device
5. Configure pricing rules for the device

### Authentication Key
The system authentication key is used to prevent unauthorized NodeMCU devices from connecting to your network. This key should be:
- Unique for each installation
- Kept secret
- Changed periodically for security

## Troubleshooting

### Cannot Connect to Hotspot
- Ensure the NodeMCU is powered properly
- Check that no other devices are interfering
- Try resetting the NodeMCU

### Captive Portal Not Appearing
- Manually navigate to `http://192.168.4.1` in your browser
- Clear browser cache and cookies
- Try a different device

### Cannot Detect PisoWiFi Networks
- Ensure your PisoWiFi hotspot is broadcasting
- Move closer to the PisoWiFi router
- Check that the hotspot is not hidden

### Device Not Appearing in Admin Panel
- Verify the system authentication key is correct
- Check that the NodeMCU successfully connected to the network
- Restart the PisoWiFi system to refresh device detection

### Coin Detection Not Working
- Verify hardware connections to GPIO D6
- Check that the coin acceptor is properly powered
- Monitor the Serial output for debugging information
- Ensure the device is approved in the admin panel

## Technical Specifications

- **Coin Detection Pin**: GPIO D6 (can be modified in code)
- **Debounce Time**: 200ms
- **WiFi Mode**: STA after configuration, AP for setup
- **Web Server Port**: 80
- **EEPROM Usage**: 97 bytes (SSID: 32, Key: 32, Device ID: 32, Configured flag: 1)
- **Authentication**: HTTP POST with device ID and system key

## Security Considerations

- Change the default AP SSID for production use
- Use a strong system authentication key
- Regularly update the firmware
- Monitor device connections in the admin panel
- Physically secure the NodeMCU devices

## Customization

### Changing Coin Detection Pin
Modify the `COIN_PIN` definition at the top of the code:
```cpp
#define COIN_PIN D6  // Change to desired pin (D1, D2, D3, etc.)
```

### Modifying AP Settings
Change the default AP SSID and password:
```cpp
#define DEFAULT_AP_SSID "YourCustomSSID"
#define DEFAULT_AP_PASSWORD "YourPassword"  // Leave empty for open network
```

### Adjusting Debounce Time
Modify the debounce time in the `handleCoinPulse` function:
```cpp
if (interruptTime - lastInterruptTime > 200)  // Change 200 to desired milliseconds
```

## Support

For support and updates, please refer to the main PisoWiFi documentation or contact your system administrator.

## Changelog

### v1.0
- Initial release
- Basic coin detection functionality
- Captive portal setup
- WiFi scanning
- System authentication
- Persistent configuration storage