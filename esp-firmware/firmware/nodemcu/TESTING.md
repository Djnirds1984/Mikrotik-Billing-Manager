# PisoWiFi NodeMCU Firmware Test Script

This script helps verify that your NodeMCU firmware is working correctly.

## Prerequisites

1. NodeMCU ESP8266 with PisoWiFi firmware flashed
2. Computer connected to the same network as NodeMCU
3. Python 3 installed (for advanced testing)

## Basic Testing

### 1. Serial Monitor Test

Connect the NodeMCU to your computer and open Serial Monitor at 115200 baud:

```bash
# Using Arduino IDE Serial Monitor
# Or using command line (Linux/Mac):
screen /dev/ttyUSB0 115200

# Windows (using PuTTY or similar):
# Connect to COM port at 115200 baud
```

Expected boot output:
```
[PisoWiFi NodeMCU] Starting...
[Config] Loaded existing configuration
[Config] SSID: YourNetworkName
[Config] Key: your-auth-key
[GPIO] Slot 1 enabled on pin 16 (denomination: 1)
[GPIO] Slot 2 enabled on pin 5 (denomination: 5)
[WiFi] Connecting to YourNetworkName...
[WiFi] Connected!
[WiFi] IP address: 192.168.1.100
[HTTP] Server started
[PisoWiFi NodeMCU] Ready!
```

### 2. Access Point Test

If not configured, NodeMCU should create an access point:

1. Look for WiFi network named `PisoWiFi-Setup`
2. Connect to it (no password required)
3. Open browser and navigate to any website
4. You should be redirected to the configuration page

### 3. Configuration Page Test

Once connected to the NodeMCU's AP or on the same network:

```bash
# Get device information
curl http://192.168.4.1/info
# or if connected to your network:
curl http://[NODEMCU_IP]/info
```

Expected response:
```json
{
  "mac": "XX:XX:XX:XX:XX:XX",
  "ip": "192.168.4.1",
  "chipId": 123456,
  "freeHeap": 32768,
  "uptime": 120,
  "configured": false
}
```

### 4. WiFi Scan Test

```bash
curl http://192.168.4.1/scan
```

Expected response:
```json
{
  "networks": [
    {
      "ssid": "YourNetwork",
      "rssi": -65,
      "encrypted": true
    },
    {
      "ssid": "NeighborNetwork",
      "rssi": -80,
      "encrypted": false
    }
  ]
}
```

### 5. Configuration Test

```bash
# Get current configuration
curl http://192.168.4.1/config
```

Expected response for unconfigured device:
```json
{
  "configured": false,
  "ssid": "",
  "authenticationKey": "",
  "coinPins": [16, 5, 4, 14],
  "denominations": [1, 5, 10, 1],
  "slotEnabled": [true, true, false, false]
}
```

### 6. Coin Detection Simulation

```bash
# Simulate coin insertion in slot 1 (1 peso)
curl "http://192.168.4.1/coin?slot=1&denomination=1"

# Simulate coin insertion in slot 2 (5 pesos)
curl "http://192.168.4.1/coin?slot=2&denomination=5"
```

Expected response:
```json
{"success":true}
```

### 7. Check Recent Coin Detections

```bash
curl http://192.168.4.1/coins
```

Expected response:
```json
{
  "coins": [
    {
      "slot": 1,
      "denomination": 1,
      "timestamp": 1234567890
    }
  ]
}
```

## Advanced Testing with Python

Save this as `test_nodemcu.py`:

```python
import requests
import json
import time

# Replace with your NodeMCU IP address
NODEMCU_IP = "192.168.4.1"  # or your network IP
BASE_URL = f"http://{NODEMCU_IP}"

def test_endpoint(endpoint, method="GET", data=None):
    """Test an HTTP endpoint"""
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, timeout=5)
        elif method == "POST":
            response = requests.post(url, json=data, timeout=5)
        
        print(f"✓ {method} {endpoint}: {response.status_code}")
        if response.status_code == 200:
            try:
                print(f"  Response: {json.dumps(response.json(), indent=2)}")
            except:
                print(f"  Response: {response.text}")
        else:
            print(f"  Error: {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"✗ {method} {endpoint}: {e}")

def main():
    print("=== PisoWiFi NodeMCU Test ===\n")
    
    # Test device info
    print("1. Testing device info...")
    test_endpoint("/info")
    
    # Test configuration
    print("\n2. Testing configuration...")
    test_endpoint("/config")
    
    # Test WiFi scan
    print("\n3. Testing WiFi scan...")
    test_endpoint("/scan")
    
    # Test coin simulation
    print("\n4. Testing coin detection...")
    test_endpoint("/coin?slot=1&denomination=5")
    
    # Check recent coins
    print("\n5. Checking recent coins...")
    test_endpoint("/coins")
    
    # Test reboot (uncomment to test)
    # print("\n6. Testing reboot...")
    # test_endpoint("/reboot", "POST")
    
    print("\n=== Test Complete ===")

if __name__ == "__main__":
    main()
```

Run the test:
```bash
pip install requests
python test_nodemcu.py
```

## Integration Testing

### Test with PisoWiFi System

1. Ensure your main PisoWiFi system is running
2. Flash the NodeMCU with the firmware
3. Connect to `PisoWiFi-Setup` network
4. Configure the device:
   - Select your WiFi network
   - Enter your WiFi password
   - Enter the authentication key from your main system
   - Configure coin slots
   - Save configuration

5. Check the main system's admin panel:
   - The NodeMCU should appear as a pending device
   - Accept the device
   - Verify it shows as connected

### Physical Coin Test

1. Connect coin acceptors to the configured GPIO pins
2. Insert coins of different denominations
3. Verify:
   - Serial monitor shows coin detections
   - Main system receives coin events
   - User credits are updated

## Troubleshooting

### Common Test Failures

#### No Serial Output
- **Check**: USB connection and power
- **Check**: Correct baud rate (115200)
- **Solution**: Try different USB cable or port

#### HTTP 404 Errors
- **Check**: NodeMCU IP address
- **Check**: Device is properly booted
- **Solution**: Power cycle the device

#### WiFi Connection Failed
- **Check**: Correct SSID and password
- **Check**: Network is accessible
- **Solution**: Reconfigure WiFi settings

#### Coin Detection Not Working
- **Check**: GPIO pin connections
- **Check**: Coin acceptor power and ground
- **Check**: Correct pin configuration
- **Solution**: Use serial monitor to debug

### Debug Information

Check Serial Monitor for error messages:
- `[WiFi] Connection failed` - Wrong credentials or network issues
- `[Coin] Slot X triggered` - GPIO working correctly
- `[HTTP] Error` - Web server issues
- `Memory overflow` - Firmware needs optimization

## Performance Benchmarks

### Expected Values

- **Boot time**: < 5 seconds
- **WiFi connection time**: < 10 seconds
- **HTTP response time**: < 100ms
- **Coin detection latency**: < 50ms
- **Memory usage**: < 50% RAM
- **Flash usage**: < 80% program storage

### Monitoring

Use these commands to monitor performance:
```bash
# Continuous ping test
ping -c 100 192.168.4.1

# Memory monitoring
curl http://192.168.4.1/info | jq .freeHeap

# Stress test coin detection
for i in {1..100}; do 
  curl -s "http://192.168.4.1/coin?slot=1&denomination=1" > /dev/null
  echo "Iteration $i"
  sleep 0.1
done
```

## Test Results Log

Create a test log file to document results:

```bash
# Test timestamp
date >> test_results.log

# Record successful tests
echo "Serial Monitor: PASS" >> test_results.log
echo "HTTP Server: PASS" >> test_results.log
echo "WiFi Connection: PASS" >> test_results.log

# Record failed tests
echo "Coin Detection: FAIL - GPIO 5 not responding" >> test_results.log
```

This will help track which firmware versions and configurations work best.

---
**Note**: Replace IP addresses with actual device IPs in your network. The default AP mode uses `192.168.4.1`.