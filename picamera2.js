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

	var spawn = require("child_process").spawn;
	var fs = require("fs");
	var fsextra = require("fs-extra");
	var os = require("os");
	var path = require("path");
	var readline = require("readline");
	const { v4: uuidv4 } = require("uuid");

	function normalizeBool(value) {
		return value === true || value === 1 || value === "1" || value === "true";
	}

	function Picamera2TakePhotoNode(config) {
		RED.nodes.createNode(this, config);

		this.filemode = config.filemode;
		this.filename = config.filename;
		this.autoname = config.autoname;
		this.filepath = config.filepath;
		this.fileformat = config.fileformat;
		this.resolution = config.resolution;
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
		this.name = config.name;

		this.worker = null;
		this.workerReadline = null;
		this.pending = {};
		this.closing = false;

		var node = this;
		node.status({ fill: "grey", shape: "ring", text: "idle" });

		function failPendingRequests(reason) {
			Object.keys(node.pending).forEach(function(reqId) {
				var pending = node.pending[reqId];
				delete node.pending[reqId];

				pending.msg.payload = "";
				pending.msg.filename = "";
				pending.msg.fileformat = "";
				pending.msg.filepath = "";
				node.error("Capture failed: " + reason, pending.msg);
				pending.send(pending.msg);
				pending.done();
			});
		}

		function startWorker() {
			if (node.worker) {
				return;
			}

			var workerPath = path.join(__dirname, "lib", "python", "capture_worker.py");
			node.worker = spawn("python3", [workerPath], {
				stdio: ["pipe", "pipe", "pipe"],
			});

			node.workerReadline = readline.createInterface({ input: node.worker.stdout });
			node.workerReadline.on("line", function(line) {
				var response;
				try {
					response = JSON.parse(line);
				} catch (e) {
					node.warn("Ignoring invalid worker output: " + line);
					return;
				}

				var reqId = response.id;
				if (!reqId || !node.pending[reqId]) {
					return;
				}

				var pending = node.pending[reqId];
				delete node.pending[reqId];

				if (!response.ok) {
					node.status({ fill: "red", shape: "dot", text: "capture failed" });
					node.error("Capture failed: " + (response.error || "Unknown worker error"), pending.msg);
					pending.msg.payload = "";
					pending.msg.filename = "";
					pending.msg.fileformat = "";
					pending.msg.filepath = "";
					pending.send(pending.msg);
					pending.done();
					return;
				}

				pending.msg.filename = pending.filename;
				pending.msg.filepath = pending.filepath;
				pending.msg.fileformat = pending.fileformat;

				if (pending.filemode === "0") {
					try {
						pending.msg.payload = fs.readFileSync(pending.filefqn);
					} catch (e) {
						node.status({ fill: "red", shape: "dot", text: "read error" });
						node.error("Failed to read captured image: " + e.message, pending.msg);
						pending.done(e);
						return;
					}

					fsextra.remove(pending.filefqn, function(err) {
						if (err) {
							node.warn("Could not remove temp file: " + pending.filefqn);
						}
					});

					node.status({ fill: "green", shape: "dot", text: "captured (buffer)" });
				} else {
					pending.msg.payload = pending.filefqn;
					node.status({ fill: "green", shape: "dot", text: "captured: " + pending.filename });
				}

				pending.send(pending.msg);
				pending.done();

				setTimeout(function() {
					if (!node.closing) {
						node.status({ fill: "grey", shape: "ring", text: "idle" });
					}
				}, 3000);
			});

			node.worker.stderr.on("data", function(data) {
				var stderrStr = String(data || "").trim();
				if (stderrStr) {
					node.warn("camera-worker: " + stderrStr);
				}
			});

			node.worker.on("error", function(err) {
				node.status({ fill: "red", shape: "dot", text: "worker error" });
				failPendingRequests("Failed to start python worker: " + err.message);
			});

			node.worker.on("exit", function(code, signal) {
				if (!node.closing) {
					node.status({ fill: "red", shape: "dot", text: "worker stopped" });
				}
				failPendingRequests("Worker exited (code=" + code + ", signal=" + signal + ")");
				node.worker = null;
				node.workerReadline = null;
			});
		}

		node.on("input", function(msg, send, done) {
			send = send || function() { node.send.apply(node, arguments); };
			done = done || function(err) { if (err) { node.error(err, msg); } };

			var homedir = os.homedir();
			var defdir = homedir + "/Pictures/";
			var uuid = uuidv4();
			var filename;
			var filepath;
			var fileformat;
			var filemode;
			var filefqn;

			var resolution;
			var rotation;
			var fliph;
			var flipv;
			var brightness;
			var contrast;
			var sharpness;
			var exposuremode;
			var iso;
			var agcwait;
			var quality;
			var awb;

			node.status({ fill: "blue", shape: "dot", text: "preparing..." });

			if (msg.filepath && msg.filepath.trim() !== "") {
				filepath = msg.filepath;
			} else if (node.filepath) {
				filepath = node.filepath;
			} else {
				filepath = defdir;
			}
			if (filepath && !filepath.endsWith("/")) {
				filepath += "/";
			}

			if (msg.fileformat && msg.fileformat.trim() !== "") {
				fileformat = msg.fileformat;
			} else if (node.fileformat) {
				fileformat = node.fileformat;
			} else {
				fileformat = "png";
			}

			var extMap = { jpeg: "jpg", png: "png", bmp: "bmp" };
			var ext = extMap[fileformat] || "jpg";

			if (msg.filemode && msg.filemode !== "") {
				filemode = msg.filemode;
			} else if (node.filemode) {
				filemode = node.filemode;
			} else {
				filemode = "1";
			}

			if (filemode === "0") {
				filename = "tmp_" + uuid + "." + ext;
				filefqn = filepath + filename;
			} else if (filemode === "2") {
				var autoname = (msg.autoname && msg.autoname.trim() !== "") ? msg.autoname : (node.autoname || "image");
				var now = new Date();
				var timestamp = now.getFullYear()
					+ ("0" + (now.getMonth() + 1)).slice(-2)
					+ ("0" + now.getDate()).slice(-2)
					+ "_"
					+ ("0" + now.getHours()).slice(-2)
					+ ("0" + now.getMinutes()).slice(-2)
					+ ("0" + now.getSeconds()).slice(-2);
				filename = autoname + "_" + timestamp + "." + ext;
				filefqn = filepath + filename;
			} else {
				var baseName = (msg.filename && msg.filename.trim() !== "") ? msg.filename.trim() : (node.filename || "image");
				baseName = baseName.replace(/\.[^/.]+$/, "");
				filename = baseName + "." + ext;
				filefqn = filepath + filename;
			}

			if (msg.resolution && msg.resolution !== "") {
				resolution = msg.resolution;
			} else if (node.resolution) {
				resolution = node.resolution;
			} else {
				resolution = "10";
			}

			var resolutionMap = {
				"1": [320, 240],
				"2": [640, 480],
				"3": [800, 600],
				"4": [1024, 768],
				"5": [1280, 720],
				"6": [1640, 922],
				"7": [1640, 1232],
				"8": [1920, 1080],
				"9": [2592, 1944],
				"10": [3280, 2464],
			};
			var size = resolutionMap[resolution] || resolutionMap["10"];

			rotation = (msg.rotation && msg.rotation !== "") ? msg.rotation : (node.rotation || "0");
			fliph = (msg.fliph && msg.fliph !== "") ? msg.fliph : (node.fliph || "0");
			flipv = (msg.flipv && msg.flipv !== "") ? msg.flipv : (node.flipv || "0");
			brightness = (msg.brightness && msg.brightness !== "") ? msg.brightness : (node.brightness || "50");
			contrast = (msg.contrast && msg.contrast !== "") ? msg.contrast : (node.contrast || "0");
			sharpness = (msg.sharpness && msg.sharpness !== "") ? msg.sharpness : (node.sharpness || "0");
			exposuremode = (msg.exposuremode && msg.exposuremode !== "") ? msg.exposuremode : (node.exposuremode || "auto");
			iso = (msg.iso && msg.iso !== "") ? msg.iso : (node.iso || "0");
			agcwait = (msg.agcwait && msg.agcwait !== "") ? msg.agcwait : (node.agcwait || 1.0);
			quality = (msg.quality && msg.quality !== "") ? msg.quality : (node.quality || 80);
			awb = (msg.awb && msg.awb !== "") ? msg.awb : (node.awb || "auto");

			try {
				fsextra.ensureDirSync(filepath);
			} catch (e) {
				node.status({ fill: "red", shape: "dot", text: "dir error" });
				node.error("Cannot create output directory: " + filepath + " - " + e.message, msg);
				done(e);
				return;
			}

			startWorker();
			if (!node.worker || !node.worker.stdin || node.worker.killed) {
				node.status({ fill: "red", shape: "dot", text: "worker unavailable" });
				node.error("Capture failed: worker unavailable", msg);
				done();
				return;
			}

			node.status({ fill: "yellow", shape: "dot", text: "taking picture..." });

			var reqId = uuidv4();
			node.pending[reqId] = {
				msg: msg,
				send: send,
				done: done,
				filemode: String(filemode),
				filename: filename,
				filepath: filepath,
				fileformat: fileformat,
				filefqn: filefqn,
			};

			var request = {
				cmd: "capture",
				id: reqId,
				filename: filename,
				filepath: filepath,
				fileformat: fileformat,
				resolutionX: size[0],
				resolutionY: size[1],
				rotation: parseInt(rotation, 10),
				hflip: normalizeBool(fliph),
				vflip: normalizeBool(flipv),
				brightness: parseInt(brightness, 10),
				contrast: parseInt(contrast, 10),
				sharpness: parseInt(sharpness, 10),
				exposuremode: exposuremode,
				iso: parseInt(iso, 10),
				agcwait: parseFloat(agcwait),
				quality: parseInt(quality, 10),
				awb: awb,
			};

			try {
				node.worker.stdin.write(JSON.stringify(request) + "\n");
			} catch (e) {
				delete node.pending[reqId];
				node.status({ fill: "red", shape: "dot", text: "worker write error" });
				node.error("Capture failed: " + e.message, msg);
				done(e);
			}
		});

		node.on("close", function(removed, done) {
			node.closing = true;
			failPendingRequests("Node is closing");

			if (node.worker && !node.worker.killed) {
				try {
					node.worker.stdin.write(JSON.stringify({ cmd: "shutdown", id: "close" }) + "\n");
				} catch (e) {
					// Ignore worker write errors during shutdown.
				}
				setTimeout(function() {
					if (node.worker && !node.worker.killed) {
						node.worker.kill();
					}
				}, 500);
			}

			node.status({});
			done();
		});
	}

	RED.nodes.registerType("picamera2-takephoto", Picamera2TakePhotoNode);
};
