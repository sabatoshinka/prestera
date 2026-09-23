import { safeAvatar } from "./media-utils";
import { profileData, safeBanner } from "./profile-data";
import { EventAudio } from "./event-audio";
import { captureWindow } from "./window-video";
import { videoStats } from "./stream-stats";
import { streamBitrate } from "./stream-quality";
import {
  ScreenRecovery,
  screenParameters,
  refreshScreenSender,
  updateSender,
} from "./screen-recovery";
const bridge = window.pibble;
const MAX_FILE = 25 * 1024 * 1024;
const CHUNK = 16 * 1024;
export const QUALITY = {
  "1080p60": {
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 10_000_000,
    label: "1080p · 60 FPS",
  },
  "1080p30": {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 6_000_000,
    label: "1080p · 30 FPS",
  },
  "720p60": {
    width: 1280,
    height: 720,
    fps: 60,
    bitrate: 5_000_000,
    label: "720p · 60 FPS",
  },
  "720p30": {
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 3_000_000,
    label: "720p · 30 FPS",
  },
};
export class ClubEngine {
  constructor(update, message, notify) {
    this.update = update;
    this.message = message;
    this.notify = notify;
    this.peers = new Map();
    this.room = null;
    this.settings = {};
    this.cameraRequest = 0;
    this.cameraWanted = false;
    this.cameraUpdates = Promise.resolve();
    this.shareRequest = 0;
    this.shareStarting = false;
    this.activeSounds = new Set();
    this.musicQueue = [];
    this.events = new EventAudio();
    this.videoEnded = bridge.onWindowVideoEnded((text) => {
      this.notify(text);
      this.stopShare();
    });
    this.musicIndex = -1;
    this.state = { mic: false, deafen: false, camera: false, screen: false };
    this.tasks = new Map();
    this.disposed = false;
    this.pendingEvents = [];
    this.entering = false;
    this.unsubscribe = bridge.onRoom((event) => this.onEvent(event));
    this.audioEnded = bridge.onAudioEnded((text) => {
      this.notify(text);
      this.stopShare();
    });
  }
  snapshot() {
    return {
      room: this.room,
      peers: [...this.peers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        avatar: p.avatar || "",
        ...profileData(p),
        banner: p.banner || "",
        music: p.music,
        state: p.remoteState,
        connection: p.pc.connectionState,
        voiceStream: p.voiceStream,
        cameraStream: p.cameraStream,
        screenStream: p.screenStream,
        musicStream: p.musicStream,
        stats: p.stats,
      })),
      state: { ...this.state },
      localCamera: this.cameraStream,
      localScreen: this.screenStream,
      screenInfo: this.screenInfo,
      micLevel: this.micLevel || 0,
      micDb: this.micDb ?? -96,
      gateOpen: this.gateOpen ?? true,
      music: {
        queue: this.musicQueue.map(({ id, name }) => ({ id, name })),
        index: this.musicIndex,
        playing: !!this.musicElement && !this.musicElement.paused,
        position: this.musicElement?.currentTime || 0,
        duration: Number.isFinite(this.musicElement?.duration)
          ? this.musicElement.duration
          : 0,
      },
    };
  }
  emit() {
    if (!this.disposed) this.update(this.snapshot());
  }
  cue(name) {
    if (this.state.deafen && ["join", "leave", "message"].includes(name))
      return;
    this.events.play(name, this.settings);
  }
  sendProfile(peer) {
    this.sendJSON(peer, { type: "profile", ...profileData(this.settings) });
    this.sendJSON(peer, {
      type: "profile-banner",
      banner: safeBanner(this.settings.banner),
    });
  }
  async audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48000,
      });
      this.voiceDestination = this.ctx.createMediaStreamDestination();
      this.micGain = this.ctx.createGain();
      this.micGain.connect(this.voiceDestination);
      this.soundGain = this.ctx.createGain();
      this.soundGain.connect(this.voiceDestination);
      this.localSoundGain = this.ctx.createGain();
      this.localSoundGain.connect(this.ctx.destination);
      this.musicDestination = this.ctx.createMediaStreamDestination();
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.musicDestination);
      this.localMusicGain = this.ctx.createGain();
      this.localMusicGain.connect(this.ctx.destination);
      this.audioReady = this.ctx.audioWorklet
        .addModule("voice-gate-worklet.js")
        .then(() => {
          this.micGate = new AudioWorkletNode(this.ctx, "pibble-voice-gate");
          this.micFilter = this.ctx.createBiquadFilter();
          this.micFilter.type = "highpass";
          this.micFilter.connect(this.micGate).connect(this.micGain);
          this.micGate.port.onmessage = ({ data }) => {
            this.micDb = data.db;
            this.gateOpen = data.open;
          };
          this.applyVolumes();
        });
      this.applyVolumes();
    }
    await this.audioReady;
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }
  applyVolumes() {
    this.micGate?.port.postMessage({
      enabled: this.settings.gateEnabled,
      threshold: this.settings.gateThreshold,
      hold: this.settings.gateHold,
    });
    if (this.micFilter)
      this.micFilter.frequency.value =
        this.settings.noiseMode === "voice" ? 100 : 0;
    if (this.musicGain)
      this.musicGain.gain.value = (this.settings.musicGain ?? 65) / 100;
    if (this.localMusicGain)
      this.localMusicGain.gain.value = this.state.deafen
        ? 0
        : (((this.settings.musicGain ?? 65) / 100) *
            (this.settings.outputGain ?? 100)) /
          100;
    if (this.micGain)
      this.micGain.gain.value = (this.settings.micGain ?? 100) / 100;
    if (this.soundGain)
      this.soundGain.gain.value = (this.settings.soundGain ?? 65) / 100;
    if (this.localSoundGain)
      this.localSoundGain.gain.value = this.state.deafen
        ? 0
        : (((this.settings.soundGain ?? 65) / 100) *
            (this.settings.outputGain ?? 100)) /
          100;
  }
  async applySettings(settings) {
    const old = this.settings;
    this.settings = settings;
    this.applyVolumes();
    if (this.shareQuality && old.streamMbps !== settings.streamMbps) {
      this.shareQuality = {
        ...this.shareQuality,
        bitrate: streamBitrate(settings.streamMbps, this.sharePresetBitrate),
      };
      await Promise.all(
        [...this.peers.values()].map((peer) => this.limitBitrates(peer)),
      );
      this.emit();
    }
    if (
      JSON.stringify(profileData(old)) !==
        JSON.stringify(profileData(settings)) ||
      old.banner !== settings.banner
    )
      for (const peer of this.peers.values()) this.sendProfile(peer);
    if (this.ctx?.setSinkId)
      await this.ctx.setSinkId(settings.output || "").catch(() => {});
    if (
      this.micStream &&
      ["mic", "noise", "noiseMode", "echo", "autoGain"].some(
        (k) => old[k] !== settings[k],
      )
    )
      await this.acquireMic();
    if (this.cameraWanted && old.camera !== settings.camera) {
      const stopped = this.setCamera(false);
      const request = this.cameraRequest;
      await stopped;
      if (this.cameraRequest === request && this.room)
        await this.setCamera(true);
    }
  }
  async acquireMic() {
    await this.audio();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.settings.mic ? { exact: this.settings.mic } : undefined,
        noiseSuppression: this.settings.noiseMode
          ? this.settings.noiseMode !== "off"
          : this.settings.noise !== false,
        echoCancellation: this.settings.echo !== false,
        autoGainControl: this.settings.autoGain !== false,
        channelCount: 1,
      },
      video: false,
    });
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.micFilter);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.micSource.connect(this.analyser);
    for (const track of stream.getTracks())
      track.enabled = this.state.mic && !this.state.deafen;
    stream.getAudioTracks()[0].onended = () => {
      this.state.mic = false;
      this.broadcastState();
      this.emit();
      this.notify("Микрофон отключён от компьютера.");
    };
  }
  async enter(result, settings) {
    this.entering = true;
    this.settings = settings;
    this.room = result;
    this.state = { mic: false, deafen: false, camera: false, screen: false };
    await this.audio();
    for (const peer of result.peers) this.addPeer(peer, true);
    this.entering = false;
    for (const event of this.pendingEvents.splice(0)) this.onEvent(event);
    this.emit();
    try {
      await this.toggleMic();
    } catch (error) {
      this.notify("Вошли без микрофона. " + error.message);
    }
    this.statsTimer = setInterval(() => this.collectStats(), 2000);
    this.cue("join");
    this.levelTimer = setInterval(() => {
      if (this.analyser && this.state.mic) {
        const bytes = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(bytes);
        this.micLevel = Math.min(
          1,
          Math.sqrt(
            bytes.reduce((s, b) => s + ((b - 128) / 128) ** 2, 0) /
              bytes.length,
          ) * 5,
        );
      } else this.micLevel = 0;
      const talking =
        this.state.mic && this.gateOpen !== false && this.micLevel > 0.04;
      if (this.state.talking !== talking) {
        this.state.talking = talking;
        this.broadcastState();
      }
      this.emit();
    }, 160);
  }
  onEvent(event) {
    if (!this.room || this.entering) {
      if (this.pendingEvents.length < 128) this.pendingEvents.push(event);
      return;
    }
    if (event.type === "peer-joined") {
      this.cue("join");
      this.addPeer(event.peer, false);
      this.notify(`${event.peer.name} в комнате`);
    }
    if (event.type === "peer-left") {
      this.cue("leave");
      this.removePeer(event.id);
    }
    if (event.type === "signal") {
      const prior = this.tasks.get(event.from) || Promise.resolve();
      const next = prior
        .then(() => this.receiveSignal(event.from, event.data))
        .catch((error) => {
          if (this.room) this.notify("Соединение: " + error.message);
        });
      this.tasks.set(event.from, next);
    }
    if (event.type === "disconnected") {
      this.notify(
        "Создатель закрыл комнату или пропало соединение. Можно войти снова по приглашению.",
      );
      this.leave();
    }
  }
  async sendSignal(id, data) {
    if (this.room) await bridge.signal({ type: "signal", to: id, data });
  }
  addPeer(info, initiator) {
    if (this.peers.has(info.id)) return;
    const pc = new RTCPeerConnection({
      iceServers: this.room.iceServers,
      iceTransportPolicy:
        this.settings.forceRelay && this.room.connectionMode === "vps"
          ? "relay"
          : "all",
      bundlePolicy: "max-bundle",
    });
    const peer = {
      ...info,
      pc,
      initiator,
      remoteState: { mic: false, camera: false, screen: false, deafen: false },
      polite: this.room.self.localeCompare(info.id) > 0,
      makingOffer: false,
      ignoreOffer: false,
      settingAnswer: false,
      candidates: [],
      transfers: new Map(),
      outbound: Promise.resolve(),
      stats: {},
      retries: 0,
      voiceStream: new MediaStream(),
      cameraStream: new MediaStream(),
      screenStream: new MediaStream(),
      musicStream: new MediaStream(),
    };
    this.peers.set(info.id, peer);
    // Only the offerer creates media sections. The answerer adopts these exact
    // transceivers after setRemoteDescription, avoiding duplicate media sections.
    peer.transceivers = initiator
      ? ["audio", "video", "video", "audio", "audio"].map((kind) =>
          pc.addTransceiver(kind, { direction: "sendrecv" }),
        )
      : [];
    peer.sendersReady = this.attachLocalTracks(peer);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate)
        this.sendSignal(info.id, { candidate: candidate.toJSON() }).catch(
          () => {},
        );
    };
    pc.onnegotiationneeded = async () => {
      if (
        (!initiator && !pc.remoteDescription) ||
        pc.signalingState !== "stable"
      )
        return;
      try {
        peer.makingOffer = true;
        await peer.sendersReady;
        await pc.setLocalDescription();
        await this.sendSignal(info.id, {
          description: pc.localDescription.toJSON(),
        });
      } catch (error) {
        if (pc.signalingState !== "closed")
          this.notify("Не удалось согласовать звонок: " + error.message);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.ontrack = (event) => {
      const index = pc.getTransceivers().indexOf(event.transceiver);
      const stream =
        index === 0
          ? peer.voiceStream
          : index === 1
            ? peer.cameraStream
            : index === 4
              ? peer.musicStream
              : peer.screenStream;
      for (const old of stream
        .getTracks()
        .filter((t) => t.kind === event.track.kind))
        stream.removeTrack(old);
      stream.addTrack(event.track);
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && peer.retries++ < 2)
        pc.restartIce();
      if (pc.connectionState === "connected") {
        peer.retries = 0;
        this.limitBitrates(peer);
      }
      this.emit();
    };
    pc.ondatachannel = ({ channel }) => this.attachChannel(peer, channel);
    if (initiator)
      this.attachChannel(peer, pc.createDataChannel("club", { ordered: true }));
    this.emit();
  }
  async attachLocalTracks(peer) {
    const tracks = [
      this.voiceDestination?.stream.getAudioTracks()[0],
      this.cameraStream?.getVideoTracks()[0],
      this.screenStream?.getVideoTracks()[0],
      this.shareAudioStream?.getAudioTracks()[0],
      this.musicDestination?.stream.getAudioTracks()[0],
    ];
    await Promise.all(
      peer.transceivers.map((transceiver, i) => {
        transceiver.direction = "sendrecv";
        if (i === 1 || i === 2) {
          // Prefer the broadly hardware-accelerated Windows codec while keeping
          // the remaining codecs available to peers without H.264 support.
          const codecs = RTCRtpSender.getCapabilities("video")?.codecs || [];
          const preferred = codecs.filter(
            (c) =>
              c.mimeType.toLowerCase() === "video/h264" &&
              c.sdpFmtpLine?.includes("packetization-mode=1"),
          );
          if (preferred.length) {
            try {
              transceiver.setCodecPreferences([
                ...preferred,
                ...codecs.filter((c) => !preferred.includes(c)),
              ]);
            } catch {}
          }
        }
        return transceiver.sender.replaceTrack(tracks[i] || null);
      }),
    );
  }
  async receiveSignal(id, data) {
    const peer = this.peers.get(id);
    if (!peer) return;
    const pc = peer.pc;
    if (data.description) {
      const description = data.description;
      const ready =
        !peer.makingOffer &&
        (pc.signalingState === "stable" || peer.settingAnswer);
      const collision = description.type === "offer" && !ready;
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      peer.settingAnswer = description.type === "answer";
      try {
        await pc.setRemoteDescription(description);
      } finally {
        peer.settingAnswer = false;
      }
      if (!peer.transceivers.length) {
        peer.transceivers = pc.getTransceivers().slice(0, 5);
        peer.sendersReady = this.attachLocalTracks(peer);
        await peer.sendersReady;
      }
      for (const candidate of peer.candidates.splice(0))
        await pc.addIceCandidate(candidate).catch(() => {});
      if (description.type === "offer") {
        await pc.setLocalDescription();
        await this.sendSignal(id, {
          description: pc.localDescription.toJSON(),
        });
      }
      await this.limitBitrates(peer);
    } else if (data.candidate && !peer.ignoreOffer) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else if (peer.candidates.length < 128)
        peer.candidates.push(data.candidate);
    }
  }
  attachChannel(peer, channel) {
    if (peer.channel && peer.channel !== channel) {
      channel.close();
      return;
    }
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.onopen = () => {
      this.sendJSON(peer, { type: "state", ...this.state });
      this.sendProfile(peer);
      this.sendJSON(peer, this.musicMessage());
      this.emit();
    };
    channel.onmessage = ({ data }) => {
      try {
        if (typeof data === "string") {
          if (data.length <= 65536) this.receiveJSON(peer, JSON.parse(data));
        } else this.receiveChunk(peer, data);
      } catch {
        this.notify(`Некорректные данные от ${peer.name}`);
      }
    };
    channel.onclose = () => {
      for (const t of peer.transfers.values()) clearTimeout(t.timer);
      peer.transfers.clear();
      this.emit();
    };
  }
  sendJSON(peer, data) {
    if (peer.channel?.readyState === "open")
      peer.channel.send(JSON.stringify(data));
  }
  receiveJSON(peer, data) {
    if (data.type === "profile") {
      Object.assign(peer, profileData(data));
      this.emit();
    }
    if (data.type === "profile-banner") {
      peer.banner = safeBanner(data.banner);
      this.emit();
    }
    if (data.type === "music") {
      peer.music = {
        playing: !!data.playing,
        title: String(data.title || "").slice(0, 120),
      };
      this.emit();
    }
    if (data.type === "state") {
      peer.remoteState = {
        mic: !!data.mic,
        deafen: !!data.deafen,
        camera: !!data.camera,
        screen: !!data.screen,
        talking: !!data.mic && !!data.talking,
      };
      this.emit();
    }
    if (
      data.type === "chat" &&
      typeof data.text === "string" &&
      data.text.length <= 8000 &&
      typeof data.id === "string" &&
      data.id.length < 80
    ) {
      this.message({
        id: `${peer.id}:${data.id}`,
        from: peer.id,
        name: peer.name,
        color: peer.color,
        avatar: peer.avatar,
        text: data.text,
        time: Date.now(),
        roomId: this.room.roomId,
      });
      this.cue("message");
    }
    if (data.type === "file-start") {
      if (
        peer.transfers.size >= 2 ||
        !Number.isSafeInteger(data.size) ||
        data.size < 1 ||
        data.size > MAX_FILE ||
        typeof data.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(data.id) ||
        typeof data.name !== "string" ||
        data.name.length > 255
      )
        return;
      if (peer.transfers.has(data.id)) return;
      const transfer = {
        ...data,
        mime: String(data.mime || "").slice(0, 100),
        chunks: [],
        received: 0,
        time: Date.now(),
      };
      transfer.timer = setTimeout(() => peer.transfers.delete(data.id), 120000);
      peer.transfers.set(data.id, transfer);
    }
    if (data.type === "file-end") {
      const transfer = peer.transfers.get(data.id);
      if (!transfer) return;
      clearTimeout(transfer.timer);
      peer.transfers.delete(data.id);
      if (transfer.received !== transfer.size)
        return this.notify(`Файл ${transfer.name} получен не полностью`);
      const blob = new Blob(transfer.chunks, { type: transfer.mime });
      this.message({
        id: `${peer.id}:${transfer.id}`,
        from: peer.id,
        name: peer.name,
        color: peer.color,
        avatar: peer.avatar,
        time: Date.now(),
        roomId: this.room.roomId,
        file: {
          name: transfer.name,
          size: transfer.size,
          mime: transfer.mime,
          blob,
        },
      });
      this.cue("message");
    }
  }
  receiveChunk(peer, data) {
    if (
      !(data instanceof ArrayBuffer) ||
      data.byteLength < 37 ||
      data.byteLength > CHUNK + 36
    )
      return;
    const id = new TextDecoder().decode(new Uint8Array(data, 0, 36));
    const transfer = peer.transfers.get(id);
    if (!transfer) return;
    const chunk = data.slice(36);
    if (transfer.received + chunk.byteLength > transfer.size) {
      clearTimeout(transfer.timer);
      peer.transfers.delete(id);
      return;
    }
    transfer.chunks.push(chunk);
    transfer.received += chunk.byteLength;
    clearTimeout(transfer.timer);
    transfer.timer = setTimeout(() => peer.transfers.delete(id), 120000);
  }
  broadcastState() {
    for (const peer of this.peers.values())
      this.sendJSON(peer, { type: "state", ...this.state });
  }
  async toggleMic() {
    if (!this.room) return;
    if (
      !this.micStream ||
      this.micStream.getAudioTracks()[0]?.readyState === "ended"
    )
      await this.acquireMic();
    if (this.state.deafen) {
      this.state.deafen = false;
      this.applyVolumes();
    }
    this.state.mic = !this.state.mic;
    this.state.talking = false;
    this.cue(this.state.mic ? "mic-on" : "mic-off");
    this.micStream.getAudioTracks().forEach((t) => {
      t.enabled = this.state.mic;
    });
    this.broadcastState();
    this.emit();
  }
  toggleDeafen() {
    if (!this.room) return;
    this.state.deafen = !this.state.deafen;
    this.cue(this.state.deafen ? "deafen-on" : "deafen-off");
    if (this.state.deafen) {
      this.wasMic = this.state.mic;
      this.state.mic = false;
    } else this.state.mic = !!this.wasMic;
    this.micStream?.getAudioTracks().forEach((t) => {
      t.enabled = this.state.mic;
    });
    this.applyVolumes();
    this.broadcastState();
    this.emit();
  }
  async replaceSlot(slot, track) {
    await Promise.all(
      [...this.peers.values()].map(async (p) => {
        if (p.transceivers[slot])
          await p.transceivers[slot].sender.replaceTrack(track);
        await this.limitBitrates(p);
      }),
    );
  }
  async toggleCamera() {
    if (!this.room) return;
    return this.setCamera(!this.cameraWanted);
  }
  releaseCamera() {
    this.cameraStream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.cameraStream = null;
    this.state.camera = false;
  }
  syncCamera(request, track) {
    this.cameraUpdates = this.cameraUpdates
      .catch(() => {})
      .then(async () => {
        if (request !== this.cameraRequest) return;
        await Promise.allSettled(
          [...this.peers.values()].map((p) =>
            p.transceivers[1]?.sender.replaceTrack(track),
          ),
        );
      });
    return this.cameraUpdates;
  }
  async setCamera(enabled) {
    const request = ++this.cameraRequest,
      room = this.room;
    const wasOn = this.state.camera;
    this.cameraWanted = enabled;
    this.releaseCamera();
    this.broadcastState();
    this.emit();
    if (!enabled) {
      if (wasOn) this.cue("camera-off");
      return this.syncCamera(request, null);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.settings.camera
            ? { exact: this.settings.camera }
            : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      if (
        request !== this.cameraRequest ||
        room !== this.room ||
        !this.room ||
        this.disposed
      ) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.cameraStream = stream;
      await this.syncCamera(request, stream.getVideoTracks()[0]);
      if (request !== this.cameraRequest) return;
      this.state.camera = true;
      stream.getVideoTracks()[0].onended = () => {
        if (request === this.cameraRequest)
          this.setCamera(false).catch(() => {});
      };
      this.cue("camera-on");
    } catch (error) {
      if (request !== this.cameraRequest) return;
      this.cameraWanted = false;
      this.releaseCamera();
      this.broadcastState();
      this.emit();
      throw error;
    }
    this.broadcastState();
    this.emit();
  }
  async startShare(choice) {
    if (!this.room) return;
    if (this.shareStarting)
      throw new Error("Дождись завершения запуска демонстрации");
    this.shareStarting = true;
    const room = this.room;
    let request;
    const preset = QUALITY[choice.quality] || QUALITY["1080p60"];
    this.sharePresetBitrate = preset.bitrate;
    const quality = {
      ...preset,
      bitrate: streamBitrate(
        choice.streamMbps ?? this.settings.streamMbps,
        preset.bitrate,
      ),
    };
    this.shareQuality = quality;
    let video,
      audio,
      captureInfo = { backend: "Chromium · WebRTC" };
    const current = () => {
      if (room !== this.room || request !== this.shareRequest || this.disposed)
        throw new Error("Демонстрация отменена");
    };
    try {
      await this.stopShare();
      request = this.shareRequest;
      current();
      await this.audio();
      current();
      await bridge.selectSource(choice);
      current();
      const borderless =
        (choice.mode || this.settings.captureMode || "borderless") ===
        "borderless";
      if (borderless && choice.id.startsWith("window:")) {
        if (!this.settings.nativeVideo)
          throw new Error(
            "В сборке отсутствует модуль GPU-захвата. Распакуй приложение целиком.",
          );
        if (choice.audio === "system")
          throw new Error(
            "Для окна без рамки выбери звук приложения или аудиоустройство. Все звуки компьютера доступны при показе экрана целиком.",
          );
        const backends = this.settings.legacyWindowCapture
          ? ["dwm", "gdi"]
          : ["wgc", "dwm", "gdi"];
        let failure;
        for (const backend of backends) {
          current();
          await bridge.selectSource(choice);
          try {
            const capture = await captureWindow(
              { ...choice, backend },
              quality,
            );
            video = capture.stream;
            this.stopWindowVideo = capture.stop;
            captureInfo = capture.info;
            current();
            break;
          } catch (error) {
            current();
            failure = error;
          }
        }
        if (!video)
          throw new Error(
            `Это окно не удалось захватить без рамки. Выбери «Совместимый» режим или показывай экран целиком. ${failure?.message || ""}`,
          );
      }
      if (!video)
        video = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: quality.width, max: quality.width },
            height: { ideal: quality.height, max: quality.height },
            frameRate: { ideal: quality.fps, max: quality.fps },
          },
          audio: choice.audio === "system",
        });
      current();
      const track = video.getVideoTracks()[0];
      track.contentHint = "detail";
      if (choice.audio === "app") {
        if (!this.workletLoaded) {
          await this.ctx.audioWorklet.addModule("pcm-worklet.js");
          current();
          this.workletLoaded = true;
        }
        this.pcm = new AudioWorkletNode(this.ctx, "pibble-pcm", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.appDestination = this.ctx.createMediaStreamDestination();
        this.pcm.connect(this.appDestination);
        this.pcmUnsubscribe = bridge.onAppAudio((data) => {
          const bytes = new Uint8Array(data);
          this.pcm?.port.postMessage(bytes.buffer, [bytes.buffer]);
        });
        await bridge.startAppAudio(choice.id);
        current();
        audio = this.appDestination.stream;
      } else if (choice.audio === "device")
        audio = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: choice.device },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
      else if (choice.audio === "system") {
        audio = new MediaStream(video.getAudioTracks());
        if (!audio.getAudioTracks().length)
          throw new Error("Windows не предоставила системный звук.");
      }
      current();
      this.screenStream = video;
      this.shareAudioStream = audio;
      await this.replaceSlot(2, track);
      current();
      await this.replaceSlot(3, audio?.getAudioTracks()[0] || null);
      current();
      this.state.screen = true;
      this.cue("screen-on");
      this.screenInfo = {
        ...track.getSettings(),
        name: choice.name,
        quality: quality.label,
        audio: choice.audio,
        ...captureInfo,
      };
      track.onended = () => this.stopShare().catch(() => {});
      this.broadcastState();
      this.emit();
    } catch (error) {
      video?.getTracks().forEach((t) => t.stop());
      audio?.getTracks().forEach((t) => t.stop());
      await this.stopShare();
      throw error;
    } finally {
      this.shareStarting = false;
    }
  }
  async stopShare() {
    ++this.shareRequest;
    const wasSharing = this.state.screen;
    this.state.screen = false;
    for (const peer of this.peers.values()) peer.screenRecovery = null;
    this.screenStream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.screenStream = null;
    await this.stopWindowVideo?.();
    this.stopWindowVideo = null;
    await bridge.stopWindowVideo();
    this.shareAudioStream?.getTracks().forEach((t) => t.stop());
    this.shareAudioStream = null;
    await Promise.all([
      this.replaceSlot(2, null),
      this.replaceSlot(3, null),
    ]).catch(() => {});
    this.pcmUnsubscribe?.();
    this.pcmUnsubscribe = null;
    this.pcm?.disconnect();
    this.pcm = null;
    this.appDestination = null;
    await bridge.stopAppAudio();
    this.screenInfo = null;
    if (wasSharing) {
      this.cue("screen-off");
      this.broadcastState();
      this.emit();
    }
  }
  async limitBitrates(peer) {
    for (const [index, transceiver] of peer.transceivers.entries()) {
      try {
        await updateSender(transceiver.sender, async () => {
          const parameters = transceiver.sender.getParameters();
          if (!parameters.encodings?.length) return;
          parameters.encodings[0].maxBitrate =
            index === 0
              ? 96000
              : index === 1
                ? 2_500_000
                : index === 2
                  ? this.shareQuality?.bitrate || 10_000_000
                  : 192000;
          if (index === 2) {
            screenParameters(parameters, this.shareQuality);
          }
          await transceiver.sender.setParameters(parameters);
        });
      } catch {
        /* Negotiation may still be in progress. Retried on connection. */
      }
    }
  }
  sendText(text) {
    if (!this.room || !text.trim()) return;
    const msg = {
      type: "chat",
      id: crypto.randomUUID(),
      text: text.trim().slice(0, 8000),
    };
    let delivered = 0;
    for (const peer of this.peers.values())
      if (peer.channel?.readyState === "open") {
        this.sendJSON(peer, msg);
        delivered++;
      }
    this.message({
      ...msg,
      from: this.room.self,
      name: this.settings.name,
      color: this.settings.color,
      avatar: safeAvatar(this.settings.avatar),
      time: Date.now(),
      roomId: this.room.roomId,
      own: true,
      delivered,
    });
    if (this.peers.size && !delivered)
      this.notify(
        "Соединение ещё устанавливается. Сообщение пока не отправлено.",
      );
  }
  async waitForBuffer(channel) {
    if (channel.readyState !== "open") throw new Error("Участник отключился");
    if (channel.bufferedAmount < 512 * 1024) return;
    await new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        channel.removeEventListener("bufferedamountlow", low);
        channel.removeEventListener("close", close);
      };
      const low = () => {
        clean();
        resolve();
      };
      const close = () => {
        clean();
        reject(new Error("Передача прервана"));
      };
      const timer = setTimeout(() => {
        clean();
        reject(new Error("Время передачи истекло"));
      }, 30000);
      channel.addEventListener("bufferedamountlow", low);
      channel.addEventListener("close", close, { once: true });
    });
  }
  async sendFile(file, progress) {
    if (!this.room) throw new Error("Сначала войди в комнату");
    if (file.size < 1 || file.size > MAX_FILE)
      throw new Error("Можно отправлять файлы до 25 МБ");
    const data = await file.arrayBuffer(),
      id = crypto.randomUUID();
    const peers = [...this.peers.values()].filter(
      (p) => p.channel?.readyState === "open",
    );
    let sent = 0;
    const results = await Promise.allSettled(
      peers.map((peer) => {
        const work = peer.outbound
          .catch(() => {})
          .then(async () => {
            this.sendJSON(peer, {
              type: "file-start",
              id,
              name: file.name.slice(0, 255),
              size: file.size,
              mime: file.type,
            });
            for (let offset = 0; offset < data.byteLength; offset += CHUNK) {
              await this.waitForBuffer(peer.channel);
              const chunk = new Uint8Array(data.slice(offset, offset + CHUNK));
              const packet = new Uint8Array(36 + chunk.length);
              packet.set(new TextEncoder().encode(id));
              packet.set(chunk, 36);
              peer.channel.send(packet.buffer);
              sent += chunk.length;
              progress?.(
                Math.round((sent / (data.byteLength * peers.length)) * 100),
              );
            }
            this.sendJSON(peer, { type: "file-end", id });
          });
        peer.outbound = work;
        return work;
      }),
    );
    const delivered = results.filter((r) => r.status === "fulfilled").length;
    this.message({
      id,
      from: this.room.self,
      name: this.settings.name,
      color: this.settings.color,
      avatar: safeAvatar(this.settings.avatar),
      time: Date.now(),
      roomId: this.room.roomId,
      own: true,
      delivered,
      file: { name: file.name, size: file.size, mime: file.type, blob: file },
    });
    if (delivered < peers.length)
      this.notify("Некоторым участникам не удалось передать файл.");
    if (!peers.length)
      this.notify(
        "Файл сохранён у тебя. В комнате пока нет подключённых друзей.",
      );
  }
  musicMessage() {
    return {
      type: "music",
      playing: !!this.musicElement && !this.musicElement.paused,
      title: this.musicQueue[this.musicIndex]?.name || "",
    };
  }
  broadcastMusic() {
    for (const peer of this.peers.values())
      this.sendJSON(peer, this.musicMessage());
    this.emit();
  }
  musicAdd(files) {
    if (this.musicQueue.length + files.length > 50)
      throw new Error("В очереди может быть до 50 треков");
    for (const file of files) {
      if (!/^audio\//.test(file.type) || file.size > 100 * 1024 * 1024)
        throw new Error("Выбери аудиофайлы до 100 МБ каждый");
    }
    this.musicQueue.push(
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
        file,
      })),
    );
    if (this.musicIndex < 0 && this.musicQueue.length) this.musicIndex = 0;
    this.emit();
  }
  musicLoadPlaylist(playlist) {
    this.releaseMusic();
    this.musicQueue = (playlist?.tracks || []).map((t) => ({
      id: t.id,
      name: t.name,
      library: true,
    }));
    this.musicIndex = this.musicQueue.length ? 0 : -1;
    this.broadcastMusic();
  }
  releaseMusic() {
    this.musicRequest = (this.musicRequest || 0) + 1;
    if (this.musicElement) {
      for (const event of [
        "onplay",
        "onpause",
        "onended",
        "ontimeupdate",
        "onloadedmetadata",
        "onerror",
      ])
        this.musicElement[event] = null;
      this.musicElement.pause();
      this.musicElement.removeAttribute("src");
      this.musicElement.load();
    }
    this.musicSource?.disconnect();
    if (this.musicUrl) URL.revokeObjectURL(this.musicUrl);
    this.musicElement = null;
    this.musicSource = null;
    this.musicUrl = null;
    this.musicLoadedId = null;
  }
  async musicPlay(index = this.musicIndex) {
    if (!this.room) throw new Error("Сначала войди в комнату");
    const track = this.musicQueue[index];
    if (!track) return;
    await this.audio();
    if (this.musicLoadedId !== track.id) {
      this.releaseMusic();
      const request = this.musicRequest;
      const file = track.library
        ? new Blob([await bridge.readMusicTrack(track.id)])
        : track.file;
      if (request !== this.musicRequest || !this.room) return;
      this.musicIndex = index;
      this.musicLoadedId = track.id;
      this.musicUrl = URL.createObjectURL(file);
      const el = new Audio();
      el.preload = "metadata";
      el.src = this.musicUrl;
      this.musicElement = el;
      this.musicSource = this.ctx.createMediaElementSource(el);
      this.musicSource.connect(this.musicGain);
      this.musicSource.connect(this.localMusicGain);
      el.onplay = el.onpause = () => this.broadcastMusic();
      el.ontimeupdate = el.onloadedmetadata = () => this.emit();
      el.onended = () => {
        if (this.musicIndex + 1 < this.musicQueue.length)
          this.musicPlay(this.musicIndex + 1).catch((e) =>
            this.notify(e.message),
          );
        else this.stopMusic();
      };
      el.onerror = () => {
        this.notify("Не удалось прочитать этот аудиофайл");
        this.stopMusic();
      };
    }
    await this.musicElement.play();
    this.broadcastMusic();
  }
  musicToggle() {
    return this.musicElement && !this.musicElement.paused
      ? this.musicElement.pause()
      : this.musicPlay();
  }
  musicNext(delta) {
    if (this.musicQueue.length)
      return this.musicPlay(
        (this.musicIndex + delta + this.musicQueue.length) %
          this.musicQueue.length,
      );
  }
  musicSeek(position) {
    if (
      this.musicElement &&
      Number.isFinite(position) &&
      Number.isFinite(this.musicElement.duration)
    )
      this.musicElement.currentTime = Math.max(
        0,
        Math.min(position, this.musicElement.duration),
      );
  }
  stopMusic() {
    this.musicRequest = (this.musicRequest || 0) + 1;
    this.musicElement?.pause();
    if (this.musicElement?.readyState) this.musicElement.currentTime = 0;
    this.broadcastMusic();
  }
  musicRemove(index) {
    if (index === this.musicIndex) this.releaseMusic();
    this.musicQueue.splice(index, 1);
    if (index < this.musicIndex) this.musicIndex--;
    this.musicIndex = Math.min(this.musicIndex, this.musicQueue.length - 1);
    this.broadcastMusic();
  }
  async playSound(sound, preview = false) {
    if (!preview && !this.room)
      throw new Error("Войди в комнату или нажми кнопку прослушивания");
    await this.audio();
    const buffer = await this.ctx.decodeAudioData(
      await sound.blob.arrayBuffer(),
    );
    if (buffer.duration > 30)
      throw new Error("Звук должен быть не длиннее 30 секунд");
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (!preview) source.connect(this.soundGain);
    source.connect(this.localSoundGain);
    this.activeSounds.add(source);
    source.onended = () => {
      this.activeSounds.delete(source);
      source.disconnect();
    };
    source.start();
  }
  stopSounds() {
    for (const source of this.activeSounds) {
      try {
        source.stop();
      } catch {}
    }
    this.activeSounds.clear();
  }
  async collectStats() {
    if (this.collectingStats) return;
    this.collectingStats = true;
    try {
      for (const peer of this.peers.values()) {
        try {
          const reports = await peer.pc.getStats();
          const stats = {};
          reports.forEach((report) => {
            if (
              report.type === "candidate-pair" &&
              report.state === "succeeded" &&
              report.nominated
            ) {
              stats.rtt = Number.isFinite(report.currentRoundTripTime)
                ? Math.round(report.currentRoundTripTime * 1000)
                : undefined;
              stats.availableOutgoingBitrate = report.availableOutgoingBitrate;
              stats.route =
                reports.get(report.localCandidateId)?.candidateType ===
                  "relay" ||
                reports.get(report.remoteCandidateId)?.candidateType === "relay"
                  ? "relay"
                  : "direct";
            }
          });
          peer.videoSamples ||= new Map();
          const read = async (index, outbound) => {
            const transceiver = peer.transceivers[index];
            if (!transceiver) return {};
            try {
              return videoStats(
                await (
                  outbound ? transceiver.sender : transceiver.receiver
                ).getStats(),
                peer.videoSamples,
              );
            } catch {
              return {};
            }
          };
          [stats.screen, stats.camera, stats.sendingScreen] = await Promise.all(
            [read(2, false), read(1, false), read(2, true)],
          );
          // Keep the screen caption compatible without mixing camera statistics into it.
          Object.assign(stats, stats.screen);
          peer.stats = stats;
          const sourceTrack = this.screenStream?.getVideoTracks()[0];
          if (
            this.state.screen &&
            sourceTrack &&
            peer.pc.connectionState === "connected"
          ) {
            peer.screenRecovery ||= new ScreenRecovery();
            if (
              peer.screenRecovery.shouldRecover({
                outbound: stats.sendingScreen,
                network: stats,
                source: sourceTrack.getSettings(),
                bitrate: this.shareQuality?.bitrate || 10_000_000,
                presetBitrate: this.sharePresetBitrate,
                now: performance.now(),
              })
            ) {
              const generation = this.shareRequest;
              const sender = peer.transceivers[2]?.sender;
              const current = () =>
                generation === this.shareRequest &&
                this.state.screen &&
                this.peers.get(peer.id) === peer &&
                sender?.track === sourceTrack;
              try {
                if (
                  sender &&
                  (await refreshScreenSender(
                    sender,
                    this.shareQuality,
                    current,
                  ))
                )
                  peer.screenRecovery.count++;
              } catch {
                /* Retry only after the recovery cooldown, not on every stats tick. */
              }
            }
            stats.sendingScreen.recoveries = peer.screenRecovery?.count || 0;
          }
        } catch {}
      }
      if (this.screenInfo && this.screenStream) {
        const settings = this.screenStream.getVideoTracks()[0]?.getSettings();
        this.screenInfo = { ...this.screenInfo, ...settings };
      }
      this.emit();
    } finally {
      this.collectingStats = false;
    }
  }
  removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    for (const t of peer.transfers.values()) clearTimeout(t.timer);
    peer.pc.close();
    this.peers.delete(id);
    this.tasks.delete(id);
    this.emit();
  }
  async leave() {
    ++this.cameraRequest;
    this.cameraWanted = false;
    this.releaseCamera();
    if (this.room) this.cue("leave");
    this.pendingEvents = [];
    this.entering = false;
    clearInterval(this.statsTimer);
    clearInterval(this.levelTimer);
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.room = null;
    await this.stopShare();
    this.stopSounds();
    this.releaseMusic();
    this.cameraStream?.getTracks().forEach((t) => t.stop());
    this.cameraStream = null;
    this.micStream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.micStream = null;
    this.micSource?.disconnect();
    this.micSource = null;
    if (this.ctx) await this.ctx.close();
    this.ctx = null;
    this.micGate?.port.close();
    this.micGate = null;
    this.micFilter = null;
    this.audioReady = null;
    this.workletLoaded = false;
    this.state = { mic: false, deafen: false, camera: false, screen: false };
    await bridge.leave();
    this.emit();
  }
  async dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.audioEnded();
    this.videoEnded();
    await this.leave();
    this.events.dispose();
  }
}
