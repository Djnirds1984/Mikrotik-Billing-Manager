# Arduino IDE Configuration for PisoWiFi NodeMCU

## Board Settings

### For NodeMCU ESP8266:
- **Board**: NodeMCU 1.0 (ESP-12E Module)
- **Upload Speed**: 115200
- **CPU Frequency**: 80 MHz
- **Flash Size**: 4M (3M SPIFFS)
- **Flash Mode**: DIO
- **Flash Frequency**: 40MHz
- **Reset Method**: nodemcu
- **Debug Port**: Disabled
- **Debug Level**: None
- **IwIP Variant**: v2 Lower Memory
- **VTables**: Flash
- **Exceptions**: Disabled
- **Erase Flash**: Only Sketch
- **SSL Support**: All SSL ciphers (most compatible)
- **Port**: Select your COM port

### For ESP32 (if using ESP32 instead):
- **Board**: ESP32 Dev Module
- **Flash Frequency**: 40MHz
- **Flash Mode**: QIO
- **Partition Scheme**: Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)
- **Core Debug Level**: None
- **PSRAM**: Disabled

## Required Libraries

Install the following libraries through Arduino IDE Library Manager:

1. **ArduinoJson** by Benoit Blanchon (version 6.x)
2. **ESP8266WiFi** (built-in for ESP8266)
3. **ESP8266WebServer** (built-in for ESP8266)
4. **DNSServer** (built-in for ESP8266)
5. **EEPROM** (built-in)

### Installation Steps:
1. Open Arduino IDE
2. Go to `Sketch` → `Include Library` → `Manage Libraries`
3. Search for each library name and install

## Compilation Settings

### Compiler Warnings:
- Set to "Default" or "More" for development
- Set to "None" for production to reduce code size

### Additional Board Manager URLs:
Add this URL for ESP8266 support:
```
https://arduino.esp8266.com/stable/package_esp8266com_index.json
```

## Build Process

1. **Verify Code**: Click the checkmark (✓) to compile without uploading
2. **Upload Code**: Click the arrow (→) to compile and upload
3. **Monitor Output**: Open Serial Monitor (Ctrl+Shift+M) at 115200 baud

## Troubleshooting Compilation Errors

### Common Errors and Solutions:

#### Error: "ESP8266WiFi.h: No such file or directory"
- **Solution**: Install ESP8266 board package

#### Error: "ArduinoJson.h: No such file or directory"
- **Solution**: Install ArduinoJson library

#### Error: "Not enough memory"
- **Solution**: 
  - Use "4M (3M SPIFFS)" flash setting
  - Remove unused libraries
  - Optimize string usage

#### Error: "espcomm_upload_failed"
- **Solution**:
  - Check COM port selection
  - Press FLASH button during upload
  - Try different USB cable
  - Install correct USB drivers

## Flash Memory Layout

### ESP8266 (4MB Flash):
- **Sketch**: 1MB
- **SPIFFS**: 3MB (for file storage)
- **EEPROM**: 4KB (emulated in flash)

### EEPROM Usage:
- **Configuration**: 256 bytes
- **Reserved**: 256 bytes
- **Total**: 512 bytes

## Development Tips

### Debugging:
- Use `Serial.println()` for debugging
- Monitor at 115200 baud
- Use `ESP.deepSleep()` for power saving (optional)

### Memory Optimization:
- Use `F()` macro for strings: `Serial.println(F("Hello"))`
- Avoid String objects, use char arrays
- Use `PROGMEM` for constant data

### Power Management:
- ESP8266: ~170mA active, ~20mA WiFi connected
- Use `WiFi.forceSleepBegin()` when idle
- Consider external power supply for stable operation

## Example Build Output

Successful compilation should show:
```
Sketch uses 284,560 bytes (27%) of program storage space.
Global variables use 31,248 bytes (38%) of dynamic memory.
```

If memory usage exceeds 80%, consider optimization.

## Next Steps After Flashing

1. Open Serial Monitor at 115200 baud
2. Power cycle the device
3. Watch for boot messages
4. Connect to `PisoWiFi-Setup` WiFi network
5. Configure via captive portal

---