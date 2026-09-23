import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MediaViewer, SoundDock } from "../src/features";
import { PersonPopover } from "../src/profiles";
import { screenParameters, refreshScreenSender } from "../src/screen-recovery";
function synthetic(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 640, 360);
  return { canvas, stream: canvas.captureStream(5) };
}
const screen = synthetic("#174b73"),
  camera = synthetic("#805e43");
// Source-only WebRTC loopback: verify the parameter transition in real Chromium.
window.verifySenderRefresh = async () => {
  const left = new RTCPeerConnection({ iceServers: [] }),
    right = new RTCPeerConnection({ iceServers: [] });
  left.onicecandidate = ({ candidate }) =>
    candidate && right.addIceCandidate(candidate).catch(() => {});
  right.onicecandidate = ({ candidate }) =>
    candidate && left.addIceCandidate(candidate).catch(() => {});
  const sender = left.addTrack(screen.stream.getVideoTracks()[0]);
  try {
    await left.setLocalDescription(await left.createOffer());
    await right.setRemoteDescription(left.localDescription);
    await right.setLocalDescription(await right.createAnswer());
    await left.setRemoteDescription(right.localDescription);
    const quality = { bitrate: 2_000_000, fps: 30 };
    await sender.setParameters(
      screenParameters(sender.getParameters(), quality),
    );
    await refreshScreenSender(sender, quality);
    return {
      preference: sender.getParameters().degradationPreference,
      bitrate: sender.getParameters().encodings[0].maxBitrate,
      sameTrack: sender.track === screen.stream.getVideoTracks()[0],
      live: sender.track.readyState === "live",
    };
  } finally {
    left.close();
    right.close();
  }
};
function Fixture() {
  const [selected, select] = useState({ id: "guest", kind: "screen" });
  const [image, setImage] = useState(null),
    [profile, setProfile] = useState(false);
  const [volume, setVolume] = useState(50);
  const person = {
    id: "guest",
    name: "Guest",
    state: { camera: true, screen: true, talking: true, mic: true },
    cameraStream: camera.stream,
    screenStream: screen.stream,
  };
  const chat = (
    <div>
      <button
        onClick={() =>
          screen.canvas.toBlob((blob) => setImage({ blob, name: "image.png" }))
        }
      >
        Открыть тестовую картинку
      </button>
    </div>
  );
  return (
    <>
      <MediaViewer
        stream={selected.kind === "screen" ? screen.stream : camera.stream}
        title={selected.kind}
        people={[person]}
        selected={selected}
        soundPanel={
          <SoundDock
            sounds={[{ id: "test", name: "Тестовый звук", duration: 1 }]}
            play={() => {
              window.soundPlayed = (window.soundPlayed || 0) + 1;
            }}
            stop={() => {
              window.soundStopped = true;
            }}
            room={{}}
            volume={volume}
            setVolume={(value) => {
              setVolume(value);
              window.soundVolume = value;
            }}
            add={() => {}}
            edit={() => {}}
            remove={() => {}}
          />
        }
        focus={({ id, kind }) => select({ id, kind })}
        close={() => {
          window.viewerClosed = true;
        }}
        openProfile={() => setProfile(true)}
        controls={<button onClick={() => setProfile(true)}>Профиль</button>}
        chat={chat}
      />
      {image && (
        <MediaViewer
          file={image}
          title="image.png"
          save={() => (window.saved = true)}
          close={() => setImage(null)}
        />
      )}
      {profile && (
        <PersonPopover
          person={person}
          position={{ x: 100, y: 90 }}
          close={() => setProfile(false)}
          expand={() => {}}
          volumes={{}}
          setVolume={() => {}}
        />
      )}
    </>
  );
}
document.querySelector("#root").style.display = "none";
const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(<Fixture />);
