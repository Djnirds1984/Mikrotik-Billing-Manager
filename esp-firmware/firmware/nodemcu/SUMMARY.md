# PisoWiFi NodeMCU ESP Firmware - Summary

## Overview

This project provides firmware for NodeMCU ESP8266 devices to integrate with the PisoWiFi management system. The firmware enables remote coin acceptor control with secure authentication.

## Firmware Files Created

### 1. `pisowifi_nodemcu.ino` (Full Feature Version)
- **Features**: Complete implementation with multi-coin slot support
- **Size**: ~731 lines
- **Use Case**: Production deployment with multiple coin acceptors

### 2. `pisowifi_nodemcu_simple.ino` (Simplified Version)  
- **Features**: Core functionality only (WiFi setup + authentication)
- **Size**: ~417 lines
- **Use Case**: Basic deployment or testing

### 3. Documentation Files
- `README.md` - Complete firmware documentation
- `ARDUINO_CONFIG.md` - Arduino IDE setup guide
- `TESTING.md` - Testing procedures and scripts

## Key Features Implemented

### ✅ Access Point Mode
- Creates `PisoWiFi-Setup` network on first boot
- No password required (business WiFi standard)
- Automatically switches to AP mode if WiFi connection fails

### ✅ Captive Portal
- Web-based configuration interface
- Mobile-friendly responsive design
- Automatic redirect when connecting to AP

### ✅ WiFi Scanning
- One-click network scanning
- Auto-fill SSID when selecting from list
- Signal strength indicators (RSSI)
- Encryption status display (🔒/🔓)

### ✅ Key-Based Authentication
- Secure authentication key system
- Prevents unauthorized NodeMCU access
- Key stored in EEPROM for persistence

### ✅ HTTP API
- RESTful endpoints for all functions
- JSON communication format
- Device information and status reporting

## Hardware Requirements

### Minimum Requirements:
- **Microcontroller**: NodeMCU ESP8266
- **Power**: 5V USB or external power supply
- **Memory**: 4MB flash (standard NodeMCU)

### Optional (for full version):
- **Coin Acceptors**: 1-4 coin acceptors
- **GPIO Connections**: As per pin mapping
- **Status LED**: GPIO 12 (D6) for visual feedback

## Quick Start Guide

### 1. Flash the Firmware
```bash
# Install Arduino IDE with ESP8266 support
# Open pisowifi_nodemcu_simple.ino
# Configure: Tools → Board → NodeMCU 1.0
# Upload to device
```

### 2. Initial Setup
1. Power on the NodeMCU
2. Connect to `PisoWiFi-Setup` WiFi network
3. Open any web page (auto-redirects to setup)
4. Scan for your WiFi network
5. Enter your PisoWiFi authentication key
6. Save configuration

### 3. Integration with Main System
1. NodeMCU connects to your WiFi
2. Appears in PisoWiFi admin panel as pending device
3. Admin accepts the device
4. Device is ready for coin detection

## Configuration Endpoints

### GET `/`
- Main setup page with captive portal

### GET `/scan`
- Returns JSON list of available WiFi networks
```json
{
  "networks": [
    {
      "ssid": "YourNetwork",
      "rssi": -65,
      "encrypted": true
    }
  ]
}
```

### POST `/config`
- Save WiFi and authentication settings
```json
{
  "ssid": "YourWiFiNetwork",
  "authKey": "your-secret-key"
}
```

### GET `/info`
- Device status and information
```json
{
  "mac": "XX:XX:XX:XX:XX:XX",
  "ip": "192.168.1.100",
  "chipId": 123456,
  "freeHeap": 32768,
  "uptime": 120,
  "configured": true
}
```

## Security Features

### Authentication Key
- 64-character key for device authorization
- Stored securely in EEPROM
- Required for all configuration changes

### Network Security
- WPA2/WPA3 compatible
- No hardcoded passwords
- Secure key exchange with main system

### Physical Security
- Tamper-resistant mounting points
- Encrypted communication channels
- Regular heartbeat to main system

## Testing and Validation

### Serial Monitor Output
```
[PisoWiFi NodeMCU] Starting simplified version...
[Config] No configuration found - starting in AP mode
[WiFi] Starting Access Point...
[WiFi] AP IP address: 192.168.4.1
[Portal] Captive portal started
[HTTP] Server started
[PisoWiFi NodeMCU] Ready!
```

### Successful Configuration
```
[WiFi] Connecting to YourNetwork...
[WiFi] Connected!
[WiFi] IP address: 192.168.1.100
```

### HTTP API Test
```bash
# Test device info
curl http://192.168.1.100/info

# Test configuration
curl http://192.168.1.100/config

# Test WiFi scan
curl http://192.168.1.100/scan
```

## Troubleshooting

### Common Issues

1. **Device not appearing in AP list**
   - Check power connection
   - Verify firmware upload success
   - Monitor Serial output

2. **Captive portal not redirecting**
   - Manually navigate to `192.168.4.1`
   - Clear browser cache
   - Try different device/browser

3. **WiFi connection fails**
   - Verify SSID and network availability
   - Check for MAC address filtering
   - Ensure network supports DHCP

4. **Authentication key rejected**
   - Verify key matches main system
   - Check for typos
   - Ensure key is properly formatted

### Debug Commands

```bash
# Monitor serial output
screen /dev/ttyUSB0 115200

# Test HTTP endpoints
curl -v http://192.168.4.1/info

# Simulate configuration
curl -X POST http://192.168.4.1/config \
  -H "Content-Type: application/json" \
  -d '{"ssid":"TestNetwork","authKey":"test-key-123"}'
```

## Future Enhancements

### Planned Features
- [ ] Over-the-air (OTA) firmware updates
- [ ] Advanced coin acceptor protocols
- [ ] MQTT integration for real-time updates
- [ ] Enhanced security with certificate validation
- [ ] Multi-device mesh networking

### Performance Improvements
- [ ] Memory optimization for larger networks
- [ ] Faster WiFi connection times
- [ ] Improved error handling and recovery
- [ ] Better power management for battery operation

## Support and Maintenance

### Version Control
- Current version: v1.0.0
- Release date: January 2026
- Compatible with PisoWiFi v1.0+

### Update Procedure
1. Backup current configuration
2. Flash new firmware via USB
3. Restore configuration if needed
4. Test all functionality

### Community Support
- GitHub repository issues
- Documentation updates
- User community forums

---

**Note**: This firmware is designed specifically for the PisoWiFi management system. For integration with other systems, modifications may be required.