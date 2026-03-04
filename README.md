
# node-red-contrib-picamera2
A <a href="http://nodered.org" target="_new">Node-RED</a> node to take photos on a Raspberry Pi using the **picamera2** library (libcamera-based camera stack). This node will only work on a Raspberry Pi with a camera module enabled.

## Installation


Run the following command in the root directory of your Node-RED install or home directory (usually ~/.node-red):

```sh
        npm install node-red-contrib-picamera2
```

### Prerequisites on the Raspberry Pi

First, make sure your Raspberry Pi Camera is physically connected and detected. On Raspberry Pi OS Bookworm or later, the libcamera stack is enabled by default.

Install picamera2 if not already available:
```sh
        sudo apt-get update
        sudo apt-get install python3-picamera2
```

For 90°/270° rotation support, install Pillow:
```sh
        pip3 install Pillow
```

If you are using the default path during the file option set - the path ~/Pictures will be used.

### Runtime information
This node requires Raspberry Pi OS Bullseye or later with the libcamera camera stack. Tested with Python 3, Node.js 18+ LTS, and Node-RED 3.x+.

## Usage

### TakePhoto


This node captures a photo using the Raspberry Pi Camera via **picamera2**. Using the Filemode, the image is stored into the file-system and <b>msg.payload</b> gives you the path and filename. In Buffermode the image will reside as a buffer in <b>msg.payload</b>.


### Key differences from the legacy picamera version

- **Image effects** (negative, sketch, etc.) are no longer available — these were removed from the libcamera stack
- **LED control** is no longer available through the camera API
- **File formats** are limited to JPEG, PNG and BMP
- **AWB modes** are mapped to libcamera equivalents: auto, daylight, cloudy, tungsten, fluorescent, incandescent, indoor
- **Exposure mode** is simplified to auto/manual (manual uses the ISO/gain setting)
- **Rotation** supports 0°, 90°, 180°, 270° — 0°/180° use native transforms, 90°/270° use post-capture Pillow rotation

For the full picamera2 documentation see the <a href="https://datasheets.raspberrypi.com/camera/picamera2-manual.pdf" target="_new">picamera2 manual</a>.