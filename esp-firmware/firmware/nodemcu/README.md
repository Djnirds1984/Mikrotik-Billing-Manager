# PisoWiFi NodeMCU ESP Firmware

This firmware enables NodeMCU ESP8266/ESP32 devices to work with the PisoWiFi management system as coin acceptor controllers.

## Features

- **Access Point Mode**: Creates a WiFi hotspot for initial setup
- **Captive Portal**: Web-based configuration interface
- **WiFi Scanning**: Automatically detect and select nearby WiFi networks
- **Key-based Authentication**: Secure communication with main system
- **Multi-Coin Slot Support**: Up to 4 independent coin acceptors
- **GPIO Interrupt Handling**: Reliable coin detection with debouncing
- **HTTP API**: RESTful interface for communication
- **EEPROM Storage**: Persistent configuration storage

## Hardware Requirements

### Microcontroller
- NodeMCU ESP8266 or ESP32 Development Board

### Coin Acceptors
- Standard coin acceptors compatible with 5V logic levels
- Recommended: CH-926 series or similar multi-coin acceptors

### Wiring Diagram

```
NodeMCU ESP8266    Coin Acceptor    Description
----------------   --------------   --------------------
GPIO 16 (D0)    ->  Signal Pin     Slot 1 (1 peso)
GPIO 5  (D1)    ->  Signal Pin     Slot 2 (5 pesos)  
GPIO 4  (D2)    ->  Signal Pin     Slot 3 (10 pesos)
GPIO 14 (D5)    ->  Signal Pin     Slot 4 (custom)
GND             ->  GND            Common ground
5V/VIN          ->  VCC            Power supply
```

### GPIO Pin Mapping

| Pin | ESP8266 | Function |
|-----|---------|----------|
| D0 | GPIO 16 | Coin Slot 1 |
| D1 | GPIO 5 | Coin Slot 2 |
| D2 | GPIO 4 | Coin Slot 3 |
| D5 | GPIO 14 | Coin Slot 4 |
| D6 | GPIO 12 | Status LED (optional) |

## Installation

### Prerequisites

1. **Arduino IDE** (version 1.8.19 or later)
2. **ESP8266 Board Package**:
   - Go to `File` → `Preferences`
   - Add `https://arduino.esp8266.com/stable/package_esp8266com_index.json` to "Additional Board Manager URLs"
   - Go to `Tools` → `Board` → `Boards Manager`
   - Search for "ESP8266" and install "esp8266 by ESP8266 Community"

3. **Required Libraries**:
   - ArduinoJson (version 6.x)
   - ESP8266WiFi
   - ESP8266WebServer
   - DNSServer
   - EEPROM

### Flashing the Firmware

1. **Open the firmware file**:
   - Open `pisowifi_nodemcu.ino` in Arduino IDE

2. **Select the board**:
   - Go to `Tools` → `Board` → `ESP8266 Boards` → `NodeMCU 1.0 (ESP-12E Module)`

3. **Configure settings**:
   - `Tools` → `Flash Size` → `4M (3M SPIFFS)`
   - `Tools` → `Upload Speed` → `115200`

4. **Connect the NodeMCU**:
   - Connect NodeMCU to computer via USB
   - Select the correct COM port in `Tools` → `Port`

5. **Upload the firmware**:
   - Click the Upload button (→) in Arduino IDE
   - Wait for compilation and upload to complete

## Initial Setup

### Step 1: Power Up
1. Connect the NodeMCU to power (5V USB or external power supply)
2. The device will automatically start in Access Point mode if not configured

### Step 2: Connect to Setup Network
1. On your computer/phone, look for WiFi networks
2. Connect to the network named `PisoWiFi-Setup` (no password required)

### Step 3: Configure via Captive Portal
1. Open a web browser (any page will redirect to setup)
2. The PisoWiFi setup page will appear automatically

### Step 4: WiFi Configuration
1. Click "Scan Networks" to find available WiFi networks
2. Select your main WiFi network from the list
3. Enter the WiFi password (leave empty for open networks)

### Step 5: Authentication Key
1. Enter the authentication key from your PisoWiFi system
2. This key prevents unauthorized NodeMCU devices from connecting

### Step 6: Coin Slot Configuration
1. Configure each coin slot:
   - Enable/disable the slot
   - Select the GPIO pin
   - Set the denomination (1, 5, or 10 pesos)
2. Default configuration:
   - Slot 1: D0 (GPIO 16) - 1 peso
   - Slot 2: D1 (GPIO 5) - 5 pesos
   - Slot 3: D2 (GPIO 4) - 10 pesos (disabled)
   - Slot 4: D5 (GPIO 14) - 1 peso (disabled)

### Step 7: Save Configuration
1. Click "Save Configuration"
2. The device will save settings and reboot
3. After reboot, it will connect to your configured WiFi network

## Operation

### Normal Operation
1. Once configured, the NodeMCU will automatically connect to your WiFi network
2. Coin insertions are detected and sent to the main PisoWiFi system
3. The device can be managed remotely via the PisoWiFi admin panel

### Status Indicators
- **LED (GPIO 12/D6)**: Blinks when coins are detected
- **Serial Monitor**: Shows debug information at 115200 baud

### HTTP API Endpoints

#### GET `/`
- **Description**: Main configuration page
- **Response**: HTML setup interface

#### GET `/scan`
- **Description**: Scan for available WiFi networks
- **Response**: JSON array of networks

#### GET `/config`
- **Description**: Get current configuration
- **Response**: JSON configuration data

#### POST `/config`
- **Description**: Update configuration
- **Body**: JSON configuration data
- **Response**: `{"success": true}`

#### GET `/coin?slot=X&denomination=Y`
- **Description**: Simulate coin detection (for testing)
- **Parameters**: 
  - `slot`: Slot number (1-4)
  - `denomination`: Coin value in pesos

#### GET `/coins`
- **Description**: Get recent coin detections
- **Response**: JSON array of coin detections

#### GET `/info`
- **Description**: Get device information
- **Response**: JSON device status

#### POST `/reboot`
- **Description**: Reboot the device
- **Response**: `{"success": true}`

#### POST `/reset`
- **Description**: Reset configuration to defaults
- **Response**: `{"success": true}`

## Integration with PisoWiFi System

### Device Registration
1. The NodeMCU will automatically attempt to register with the main system
2. It sends its MAC address, IP address, and authentication key
3. Admins can approve/reject devices in the admin panel

### Coin Detection Workflow
1. Coin inserted → GPIO interrupt triggered
2. Interrupt processed → Coin detection validated
3. HTTP POST to main system: `/api/nodemcu/coin`
4. Main system validates authentication key
5. Coin credit added to user session

### API Payload Examples

#### Coin Detection
```json
{
  "macAddress": "XX:XX:XX:XX:XX:XX",
  "slot": 1,
  "denomination": 5,
  "authenticationKey": "your-auth-key-here"
}
```

#### Configuration Update
```json
{
  "ssid": "YourWiFiNetwork",
  "password": "your-password",
  "authenticationKey": "your-auth-key",
  "coinPins": [16, 5, 4, 14],
  "denominations": [1, 5, 10, 1],
  "slotEnabled": [true, true, false, false]
}
```

## Troubleshooting

### Common Issues

#### 1. Device won't connect to WiFi
- **Solution**: Reset configuration and reconfigure via captive portal
- **Check**: Verify WiFi password and network availability

#### 2. Coin detections not registering
- **Solution**: Check GPIO pin connections and wiring
- **Check**: Verify coin acceptor power and ground connections
- **Debug**: Use Serial Monitor to see interrupt triggers

#### 3. Device not appearing in admin panel
- **Solution**: Ensure authentication key matches system key
- **Check**: Verify main system is running and accessible
- **Debug**: Check Serial Monitor for registration errors

#### 4. Captive portal not working
- **Solution**: Manually navigate to `192.168.4.1` in browser
- **Check**: Ensure device is in AP mode (not connected to WiFi)

### Debugging Commands

```bash
# Monitor serial output
screen /dev/ttyUSB0 115200
# or
minicom -D /dev/ttyUSB0 -b 115200

# Test HTTP API
curl http://192.168.4.1/info
curl http://192.168.1.XXX/info

# Simulate coin detection
curl "http://192.168.1.XXX/coin?slot=1&denomination=5"
```

### Reset to Factory Defaults

1. **Physical Reset**: Hold FLASH button during boot
2. **Web Reset**: Visit `/reset` endpoint
3. **Manual Reset**: Power cycle 5 times rapidly

## Security Considerations

### Authentication Key
- Use a strong, unique key for each device
- Store keys securely in the main system
- Change keys periodically for security

### Network Security
- Use WPA2/WPA3 encryption for your WiFi network
- Change default device passwords
- Regular firmware updates

### Physical Security
- Secure coin acceptors to prevent tampering
- Mount devices in secure locations
- Monitor for unauthorized access attempts

## Firmware Updates

### Over-the-Air (OTA) Updates
- Future versions will support OTA updates
- Current version requires USB re-flashing

### Version History
- **v1.0.0**: Initial release with basic features
- **v1.1.0**: Added multi-slot support and captive portal
- **v1.2.0**: Added key-based authentication

## Support

For issues, questions, or feature requests:
- Check the GitHub repository issues
- Refer to the main PisoWiFi documentation
- Contact your system administrator

---
**Last Updated**: January 2026  
**Compatible With**: PisoWiFi Management System v1.0+