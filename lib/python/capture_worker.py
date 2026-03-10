"""
Persistent capture worker for Node-RED picamera2 node.

Reads JSON commands from stdin and writes JSON responses to stdout.
Each request keeps the camera process alive to avoid per-shot startup overhead.
"""

from picamera2 import Picamera2
import libcamera
import json
import os
import sys
import time


def write_response(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def normalize_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return False


def safe_float(value, default):
    try:
        return float(value)
    except Exception:
        return default


def safe_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


class CameraWorker:
    def __init__(self):
        try:
            cameras = Picamera2.global_camera_info()
        except Exception:
            cameras = []

        if not cameras:
            raise RuntimeError("No camera detected by libcamera")

        self.picam2 = Picamera2()
        self.camera_started = False
        self.current_config_key = None

    def _configure_camera(self, req):
        resolution_x = safe_int(req.get("resolutionX"), 3280)
        resolution_y = safe_int(req.get("resolutionY"), 2464)
        rotation = safe_int(req.get("rotation"), 0)
        hflip = normalize_bool(req.get("hflip"))
        vflip = normalize_bool(req.get("vflip"))

        needs_pil_rotate = 0
        if rotation == 180:
            hflip = not hflip
            vflip = not vflip
        elif rotation in (90, 270):
            needs_pil_rotate = rotation

        transform = libcamera.Transform(hflip=hflip, vflip=vflip)
        config_key = (resolution_x, resolution_y, hflip, vflip)

        if config_key != self.current_config_key:
            if self.camera_started:
                self.picam2.stop()
                self.camera_started = False

            config = self.picam2.create_still_configuration(
                main={"size": (resolution_x, resolution_y)},
                transform=transform,
            )
            self.picam2.configure(config)
            self.current_config_key = config_key

        if not self.camera_started:
            self.picam2.start()
            self.camera_started = True

        return needs_pil_rotate

    def _apply_controls(self, req):
        brightness = safe_int(req.get("brightness"), 50)
        contrast = safe_int(req.get("contrast"), 0)
        sharpness = safe_int(req.get("sharpness"), 0)
        exposure_mode = str(req.get("exposuremode", "auto"))
        iso = safe_int(req.get("iso"), 0)
        awb = str(req.get("awb", "auto"))

        new_brightness = (brightness - 50) / 50.0
        new_contrast = 1.0 + (contrast / 100.0)
        new_sharpness = 1.0 + (sharpness / 100.0)

        controls = {
            "Brightness": new_brightness,
            "Contrast": new_contrast,
            "Sharpness": new_sharpness,
        }

        awb_mode_map = {
            "auto": libcamera.controls.AwbModeEnum.Auto,
            "incandescent": libcamera.controls.AwbModeEnum.Incandescent,
            "tungsten": libcamera.controls.AwbModeEnum.Tungsten,
            "fluorescent": libcamera.controls.AwbModeEnum.Fluorescent,
            "indoor": libcamera.controls.AwbModeEnum.Indoor,
            "daylight": libcamera.controls.AwbModeEnum.Daylight,
            "sunlight": libcamera.controls.AwbModeEnum.Daylight,
            "cloudy": libcamera.controls.AwbModeEnum.Cloudy,
            "shade": libcamera.controls.AwbModeEnum.Cloudy,
        }

        if awb == "off":
            controls["AwbEnable"] = False
        else:
            controls["AwbEnable"] = True
            if awb in awb_mode_map:
                controls["AwbMode"] = awb_mode_map[awb]

        if exposure_mode == "auto":
            controls["AeEnable"] = True
        else:
            controls["AeEnable"] = False

        if iso > 0:
            controls["AeEnable"] = False
            controls["AnalogueGain"] = iso / 100.0

        self.picam2.set_controls(controls)

    def _post_rotate(self, filefqn, needs_pil_rotate):
        if not needs_pil_rotate:
            return

        try:
            from PIL import Image
        except ImportError:
            print(
                "WARNING: Pillow not installed, cannot apply %d degree rotation" % needs_pil_rotate,
                file=sys.stderr,
            )
            return

        img = Image.open(filefqn)
        if needs_pil_rotate == 90:
            img = img.transpose(Image.ROTATE_270)
        elif needs_pil_rotate == 270:
            img = img.transpose(Image.ROTATE_90)
        img.save(filefqn)

    def capture(self, req):
        filename = str(req.get("filename", "image.jpg"))
        filepath = str(req.get("filepath", ""))
        quality = safe_int(req.get("quality"), 80)
        agcwait = max(0.0, safe_float(req.get("agcwait"), 1.0))

        if filepath and not os.path.isdir(filepath):
            os.makedirs(filepath, exist_ok=True)

        filefqn = os.path.join(filepath, filename)

        needs_pil_rotate = self._configure_camera(req)
        self.picam2.options["quality"] = quality
        self._apply_controls(req)

        if agcwait > 0:
            time.sleep(agcwait)

        self.picam2.capture_file(filefqn)
        self._post_rotate(filefqn, needs_pil_rotate)

        return filefqn

    def close(self):
        try:
            if self.camera_started:
                self.picam2.stop()
        except Exception:
            pass
        try:
            self.picam2.close()
        except Exception:
            pass


def main():
    try:
        worker = CameraWorker()
    except Exception as exc:
        print("ERROR: %s" % str(exc), file=sys.stderr)
        sys.exit(2)

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            req_id = None
            try:
                req = json.loads(line)
                req_id = req.get("id")
                cmd = req.get("cmd")

                if cmd == "capture":
                    filefqn = worker.capture(req)
                    write_response({"id": req_id, "ok": True, "filefqn": filefqn})
                elif cmd == "shutdown":
                    write_response({"id": req_id, "ok": True})
                    break
                else:
                    write_response({"id": req_id, "ok": False, "error": "Unknown command"})
            except Exception as exc:
                write_response({"id": req_id, "ok": False, "error": str(exc)})
    finally:
        worker.close()


if __name__ == "__main__":
    main()
