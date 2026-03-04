/**
 * Copyright 2016 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * Authors:
 *   - Olaf Hahn
 **/


module.exports = function(RED) {
	"use strict";

	var settings = RED.settings;
	var exec = require("child_process").exec;
	var fs = require("fs");
	var fsextra = require("fs-extra");
	var os = require("os");
	const { v4: uuidv4 } = require('uuid');


	// Picamera2 Take Photo Node
	function Picamera2TakePhotoNode(config) {
		// Create this node
		RED.nodes.createNode(this,config);

		// set parameters and save locally
		this.filemode = config.filemode;
		this.filename =  config.filename;
		this.filedefpath = config.filedefpath;
		this.filepath = config.filepath;
		this.fileformat = config.fileformat;
		this.resolution =  config.resolution;
		this.rotation = config.rotation;
		this.fliph = config.fliph;
		this.flipv = config.flipv;
		this.sharpness = config.sharpness;
		this.brightness = config.brightness;
		this.contrast = config.contrast;
		this.exposuremode = config.exposuremode;
		this.iso = config.iso;
		this.agcwait = config.agcwait;
		this.quality = config.quality;
		this.awb = config.awb;
		this.name =  config.name;
		this.activeProcesses = {};

		var node = this;

		// Show idle status on deploy
		node.status({fill:"grey", shape:"ring", text:"idle"});

		// if there is an new input
		node.on("input", function(msg, send, done) {
			// Node-RED 0.x compatibility
			send = send || function() { node.send.apply(node, arguments); };
			done = done || function(err) { if (err) { node.error(err, msg); } };

			var uuid = uuidv4();
			var localdir = __dirname;
			var homedir = os.homedir();
			var defdir = homedir + "/Pictures/";
			var cl = "python3 " + JSON.stringify(localdir + "/lib/python/get_photo.py");
			var resolution;
			var fileformat;
			var filename;
			var filepath;
			var filemode;
			var filefqn;
			var fliph, flipv;
			var sharpness;
			var brightness;
			var contrast;
			var agcwait;
			var quality;
			var awb;
			var rotation;
			var exposuremode;
			var iso;

			node.status({fill:"blue", shape:"dot", text:"preparing..."});

			// Check the given filemode
			if((msg.filemode) && (msg.filemode !== "")) {
				filemode = msg.filemode;
			} else {
				if (node.filemode) {
					filemode = node.filemode;
				} else {
					filemode = "1";
				}
			}

			if (filemode == "0") {
				// Buffered mode (old Buffermode)
				filename = "pic_" + uuid + ".jpg";
				fileformat = "jpeg";
				filepath = homedir + "/";
				filefqn = filepath + filename;
				if (RED.settings.verbose) { node.log("picamera2 takephoto:" + filefqn); }
				console.log("Picamera2 (log): Tempfile - " + filefqn);

				cl += " " + filename + " " + filepath + " " + fileformat;
			} else if (filemode == "2") {
				// Auto file name mode (old Generate)
				filename = "pic_" + uuid + ".jpg";
				fileformat = "jpeg";
				filepath = defdir;
				filefqn = filepath + filename;
				if (RED.settings.verbose) { node.log("picamera2 takephoto:" + filefqn); }
				console.log("Picamera2 (log): Generate - " + filefqn);

				cl += " " + filename + " " + filepath + " " + fileformat;
			} else {
				 // Specific FileName
				 if ((msg.filename) && (msg.filename.trim() !== "")) {
						filename = msg.filename;
				} else {
					if (node.filename) {
						filename = node.filename;
					} else {
						filename = "pic_" + uuid + ".jpg";
					}
				}
				cl += " " + filename;

				if (node.filedefpath == "1" ) {
					filepath = defdir;
				} else {
					if ((msg.filepath) && (msg.filepath.trim() !== "")) {
						filepath = msg.filepath;
					} else {
						if (node.filepath) {
							filepath = node.filepath;
						} else {
							filepath = defdir;
						}
					}
				}
				cl += " " + filepath;

				if ((msg.fileformat) && (msg.fileformat.trim() !== "")) {
					fileformat = msg.fileformat;
				} else {
					if (node.fileformat) {
						fileformat = node.fileformat;
					} else {
						fileformat = "jpeg";
					}
				}
				cl += " " + fileformat;
				if (RED.settings.verbose) { node.log("picamera2 takephoto:" + filefqn); }
			}

			// Resolution of the image
			if ((msg.resolution) && (msg.resolution !== "")) {
				resolution = msg.resolution;
			} else {
				if (node.resolution) {
					resolution = node.resolution;
				} else {
					resolution = "10";
				}
			}
			if (resolution == "1") {
				cl += " 320 240";
			} else if (resolution == "2" ) {
				cl += " 640 480";
			} else if (resolution == "3" ) {
				cl += " 800 600";
			} else if (resolution == "4" ) {
				cl += " 1024 768";
			} else if (resolution == "5") {
				cl += " 1280 720";
			} else if (resolution == "6") {
				cl += " 1640 922";
			} else if (resolution == "7") {
				cl += " 1640 1232";
			} else if (resolution == "8" ) {
				cl += " 1920 1080";
			} else if (resolution == "9") {
				cl += " 2592 1944";
			} else {
				cl += " 3280 2464";
			}

			// rotation
			if ((msg.rotation) && (msg.rotation !== "")) {
				rotation = msg.rotation;
				} else {
					if (node.rotation) {
						rotation = node.rotation;
					} else {
						rotation = "0";
					}
				}
			cl += " " + rotation;

			// hflip and vflip
			if ((msg.fliph) && (msg.fliph !== "")) {
				fliph = msg.fliph;
			} else {
				if (node.fliph) {
					fliph = node.fliph;
				} else {
					fliph = "1";
				}
			}
			if ((msg.flipv) && (msg.flipv !== "")) {
				flipv = msg.flipv;
			} else {
				if (node.flipv) {
					flipv = node.flipv;
				} else {
					flipv= "1";
				}
			}
			cl += " " + fliph + " " + flipv;

			// brightness
			if ((msg.brightness) && (msg.brightness !== "")) {
				brightness = msg.brightness;
			} else {
				if (node.brightness) {
					brightness = node.brightness;
				} else {
					brightness = "50";
				}
			}
			cl += " " + brightness;

			// contrast
			if ((msg.contrast) && (msg.contrast !== "")) {
				contrast = msg.contrast;
			} else {
				if (node.contrast) {
					contrast = node.contrast;
				} else {
					contrast = "0";
				}
			}
			cl += " " + contrast;

			// sharpness
			if ((msg.sharpness) && (msg.sharpness !== "")) {
				sharpness = msg.sharpness;
			} else {
				if (node.sharpness) {
					sharpness = node.sharpness;
				} else {
					sharpness = "0";
				}
			}
			cl += " " + sharpness;

			// exposure-mode
			if ((msg.exposuremode) && (msg.exposuremode !== "")) {
				exposuremode = msg.exposuremode;
				} else {
					if (node.exposuremode) {
						exposuremode = node.exposuremode;
					} else {
						exposuremode = "auto";
					}
				}
			cl += " " + exposuremode;

			// iso
			if ((msg.iso) && (msg.iso !== "")) {
				iso = msg.iso;
			} else {
				if (node.iso) {
					iso = node.iso;
				} else {
					iso = "0";
				}
			}
			cl += " " + iso;

			// agcwait
			if ((msg.agcwait) && (msg.agcwait !== "")) {
				agcwait = msg.agcwait;
			} else {
				if (node.agcwait) {
					agcwait = node.agcwait;
				} else {
					agcwait = 1.0;
				}
			}
			cl += " " + agcwait;
            
			// jpeg quality
			if ((msg.quality) && (msg.quality !== "")) {
				quality = msg.quality;
			} else {
				if (node.quality) {
					quality = node.quality;
				} else {
					quality = 80;
				}
			}
			cl += " " + quality;
            
			// awb
			if ((msg.awb) && (msg.awb != "")) {
				awb = msg.awb;
			} else {
				if (node.awb) {
					awb = node.awb;
				} else {
					awb = "auto";
				}
			}
			cl += " " + awb;

			if (RED.settings.verbose) { node.log(cl); }

			filefqn = filepath + filename;

			// Ensure output directory exists
			try {
				fsextra.ensureDirSync(filepath);
			} catch(e) {
				node.status({fill:"red", shape:"dot", text:"dir error"});
				node.error("Cannot create output directory: " + filepath + " - " + e.message, msg);
				done(e);
				return;
			}

			node.status({fill:"yellow", shape:"dot", text:"taking picture..."});

			var child = exec(cl, {encoding: "binary", maxBuffer:10000000}, function (error, stdout, stderr) {
				// check error
				if (error !== null) {
					var stderrStr = stderr ? stderr.toString().trim() : "";
					var errMsg = stderrStr || error.message || "Unknown capture error";

					// Provide user-friendly status based on error
					if (stderrStr.indexOf("No camera detected") >= 0) {
						node.status({fill:"red", shape:"dot", text:"no camera found"});
					} else if (stderrStr.indexOf("list index out of range") >= 0) {
						node.status({fill:"red", shape:"dot", text:"no camera found"});
					} else {
						node.status({fill:"red", shape:"dot", text:"capture failed"});
					}

					node.error("Capture failed: " + errMsg, msg);
					msg.payload = "";
					msg.filename = "";
					msg.fileformat = "";
					msg.filepath = "";
					send(msg);
					done();
					delete node.activeProcesses[child.pid];
					return;
				}

				msg.filename = filename;
				msg.filepath = filepath;
				msg.fileformat = fileformat;

				// get the raw image into payload and delete tempfile on buffermode
				if (filemode == "0") {
					try {
						msg.payload = fs.readFileSync(filefqn);
					} catch(e) {
						node.status({fill:"red", shape:"dot", text:"read error"});
						node.error("Failed to read captured image: " + e.message, msg);
						done(e);
						delete node.activeProcesses[child.pid];
						return;
					}

					// delete tempfile
					fsextra.remove(filefqn, function(err) {
						if (err) {
							node.warn("Could not remove temp file: " + filefqn);
						}
					});

					node.status({fill:"green", shape:"dot", text:"captured (buffer)"});
				} else {
					msg.payload = filefqn;
					node.status({fill:"green", shape:"dot", text:"captured: " + filename});
				}

				send(msg);
				done();
				delete node.activeProcesses[child.pid];

				// Return to idle after 3 seconds
				setTimeout(function() {
					if (!node.closing) {
						node.status({fill:"grey", shape:"ring", text:"idle"});
					}
				}, 3000);
			});

			child.on("error", function(err) {
				node.status({fill:"red", shape:"dot", text:"exec error"});
				node.error("Failed to start python3: " + err.message, msg);
				done(err);
			});

			node.activeProcesses[child.pid] = child;

		});

		// Picamera2-TakePhoto has a close
		node.on("close", function(removed, done) {
			node.closing = true;
			// Kill any active capture processes
			for (var pid in node.activeProcesses) {
				if (node.activeProcesses.hasOwnProperty(pid)) {
					try {
						node.activeProcesses[pid].kill();
					} catch(e) { /* ignore */ }
				}
			}
			node.activeProcesses = {};
			node.status({});
			done();
		});
	}
	RED.nodes.registerType("picamera2-takephoto",Picamera2TakePhotoNode);
}
