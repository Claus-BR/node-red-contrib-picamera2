"""
Capture a still image using picamera2 (libcamera-based stack).
Replaces the legacy picamera-based script.

Usage:
    python3 get_photo.py <filename> <filepath> <fileformat>
        <resX> <resY> <rotation> <hflip> <vflip>
        <brightness> <contrast> <sharpness>
        <exposuremode> <iso> <agcwait> <quality> <awb>
"""

from picamera2 import Picamera2
import libcamera
import sys
import os
import time

# ---------------------------------------------------------------------------
# Parse command-line arguments
# ---------------------------------------------------------------------------
fileName      = sys.argv[1]
filePath      = sys.argv[2]
fileFormat     = sys.argv[3]
resolutionX   = int(sys.argv[4])
resolutionY   = int(sys.argv[5])
rotation      = int(sys.argv[6])
hflip         = sys.argv[7] == "1"
vflip         = sys.argv[8] == "1"
brightness    = int(sys.argv[9])      # 0-100  (old picamera range)
contrast      = int(sys.argv[10])     # -100..100
sharpness     = int(sys.argv[11])     # -100..100
exposuremode  = sys.argv[12]
iso           = int(sys.argv[13])
agcwait       = float(sys.argv[14])
quality       = int(sys.argv[15])
awb           = sys.argv[16]

# ---------------------------------------------------------------------------
# Convert legacy picamera value ranges -> picamera2 / libcamera ranges
# ---------------------------------------------------------------------------
# Brightness:  old 0-100 (default 50)  -> new -1.0..1.0 (default 0.0)
new_brightness = (brightness - 50) / 50.0

# Contrast:    old -100..100 (default 0) -> new 0.0+ (default 1.0)
new_contrast = 1.0 + (contrast / 100.0)

# Sharpness:   old -100..100 (default 0) -> new 0.0+ (default 1.0)
new_sharpness = 1.0 + (sharpness / 100.0)

# ISO -> AnalogueGain:  ISO 100 = gain 1.0;  0 = auto
new_gain = iso / 100.0 if iso > 0 else None

# ---------------------------------------------------------------------------
# Build transform (handles rotation, hflip, vflip)
# ---------------------------------------------------------------------------
# libcamera.Transform supports hflip and vflip natively.
# 180° rotation = hflip + vflip.
# For 90° / 270° we apply a post-capture PIL rotation.
needs_pil_rotate = 0
if rotation == 180:
    hflip = not hflip
    vflip = not vflip
elif rotation in (90, 270):
    needs_pil_rotate = rotation

transform = libcamera.Transform(hflip=hflip, vflip=vflip)

# ---------------------------------------------------------------------------
# Build file path
# ---------------------------------------------------------------------------
filefqn = os.path.join(filePath, fileName)

# Map format aliases
format_ext_map = {
    "jpeg": ".jpg",
    "jpg":  ".jpg",
    "png":  ".png",
    "bmp":  ".bmp",
    "gif":  ".gif",
}

# ---------------------------------------------------------------------------
# Configure and start camera
# ---------------------------------------------------------------------------
try:
    cameras = Picamera2.global_camera_info()
except Exception:
    cameras = []

if not cameras:
    print("ERROR: No camera detected by libcamera.", file=sys.stderr)
    print("If running in Docker, ensure the container has access to the camera devices.", file=sys.stderr)
    print("  Required: --device /dev/video0 --device /dev/video10 --device /dev/video11", file=sys.stderr)
    print("            --device /dev/video12 --device /dev/media0 --device /dev/media1", file=sys.stderr)
    print("  Or use:   --privileged", file=sys.stderr)
    print("Also check: rpicam-hello --list-cameras  on the host to verify the camera works.", file=sys.stderr)
    sys.exit(1)

picam2 = Picamera2()

config = picam2.create_still_configuration(
    main={"size": (resolutionX, resolutionY)},
    transform=transform,
)
picam2.configure(config)

# Set JPEG quality / PNG compression
picam2.options["quality"] = quality

picam2.start()

# ---------------------------------------------------------------------------
# Apply camera controls
# ---------------------------------------------------------------------------
controls = {
    "Brightness": new_brightness,
    "Contrast":   new_contrast,
    "Sharpness":  new_sharpness,
}

# Auto White Balance
awb_mode_map = {
    "auto":         libcamera.controls.AwbModeEnum.Auto,
    "incandescent": libcamera.controls.AwbModeEnum.Incandescent,
    "tungsten":     libcamera.controls.AwbModeEnum.Tungsten,
    "fluorescent":  libcamera.controls.AwbModeEnum.Fluorescent,
    "indoor":       libcamera.controls.AwbModeEnum.Indoor,
    "daylight":     libcamera.controls.AwbModeEnum.Daylight,
    "sunlight":     libcamera.controls.AwbModeEnum.Daylight,
    "cloudy":       libcamera.controls.AwbModeEnum.Cloudy,
    "shade":        libcamera.controls.AwbModeEnum.Cloudy,
}

if awb == "off":
    controls["AwbEnable"] = False
else:
    controls["AwbEnable"] = True
    if awb in awb_mode_map:
        controls["AwbMode"] = awb_mode_map[awb]

# Exposure / Gain
if exposuremode == "auto":
    controls["AeEnable"] = True
else:
    # For non-auto modes, keep AE on but apply fixed gain if ISO was set
    controls["AeEnable"] = True

if new_gain is not None:
    controls["AeEnable"] = False
    controls["AnalogueGain"] = new_gain

picam2.set_controls(controls)

# Wait for AGC / AWB to settle
time.sleep(agcwait)

# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------
picam2.capture_file(filefqn)

# ---------------------------------------------------------------------------
# Post-capture rotation for 90° / 270° (requires Pillow)
# ---------------------------------------------------------------------------
if needs_pil_rotate:
    from PIL import Image
    img = Image.open(filefqn)
    if needs_pil_rotate == 90:
        img = img.transpose(Image.ROTATE_270)   # PIL rotates counter-clockwise
    elif needs_pil_rotate == 270:
        img = img.transpose(Image.ROTATE_90)
    img.save(filefqn)

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
picam2.stop()
picam2.close()
